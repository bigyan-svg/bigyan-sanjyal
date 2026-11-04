import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteBlogPostWithVersion, updateBlogPostInTransaction } from "../src/lib/blog-content";
import { deleteBlogPostRecord, saveBlogPostRecord } from "../src/lib/blog-form";
import { handleBlogPostDelete, handleBlogPostUpdate } from "../src/lib/blog-management";
import type { AdminBlogPostItem } from "../src/lib/blog-types";
import type { BlogPostInputData } from "../src/lib/blog-validation";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-02T12:00:00.000Z");
const PUBLISHED_AT = new Date("2025-04-03T10:15:00.000Z");

function postItem(overrides: Partial<AdminBlogPostItem> = {}): AdminBlogPostItem {
  return {
    id: POST_ID,
    version: 1,
    title: "Original title",
    slug: "original-title",
    excerpt: null,
    body: "Original body",
    status: "PUBLISHED",
    publishedAt: PUBLISHED_AT.toISOString(),
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function blogPostRecord(overrides: Partial<AdminBlogPostItem> = {}) {
  const item = postItem(overrides);
  return {
    ...item,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt),
    tags: item.tags.map((tag) => ({ tag })),
  };
}

function blogTransaction(options: { barrier?: boolean; initial?: Partial<AdminBlogPostItem> } = {}) {
  let row = blogPostRecord(options.initial);
  let exists = true;
  let initialReadCount = 0;
  let releaseInitialReads!: () => void;
  const initialReadBarrier = new Promise<void>((resolve) => { releaseInitialReads = resolve; });
  const relationWrites = { categoryChecks: 0, tagDeletes: 0, tagCreates: 0 };

  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) =>
      strings.join().includes('"PostCategory"') ? [{ id: CATEGORY_ID }] : [{ id: TAG_ID }],
    post: {
      findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
        if (!exists) return null;
        if (select && Object.keys(select).length === 1 && select.id === true) return { id: POST_ID };
        const snapshot = { version: row.version, status: row.status, publishedAt: row.publishedAt };
        if (options.barrier && select?.version === true) {
          initialReadCount += 1;
          if (initialReadCount === 2) releaseInitialReads();
          await initialReadBarrier;
        }
        return snapshot;
      },
      updateManyAndReturn: async ({
        where,
        data,
      }: {
        where: { id: string; version: number };
        data: Record<string, unknown>;
      }) => {
        if (!exists || where.id !== POST_ID || row.version !== where.version) return [];
        const increment = data.version as { increment: number };
        row = { ...row, ...data, version: row.version + increment.increment } as typeof row;
        return [{ ...row }];
      },
      findUniqueOrThrow: async () => row,
    },
    postCategory: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        relationWrites.categoryChecks += 1;
        return { id: where.id };
      },
    },
    tag: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })) },
    postTag: {
      deleteMany: async () => {
        relationWrites.tagDeletes += 1;
        row = { ...row, tags: [] };
      },
      createMany: async ({ data }: { data: Array<{ tagId: string }> }) => {
        relationWrites.tagCreates += 1;
        row = { ...row, tags: data.map(({ tagId }) => ({ tag: { id: tagId, name: "Updated tag" } })) };
      },
    },
  } as never;

  return { transaction, getRow: () => row, relationWrites, setExists: (value: boolean) => { exists = value; } };
}

function updateRequest(ifMatch: string | null, body: unknown = { body: "Updated body" }) {
  const text = JSON.stringify(body);
  const headers = new Headers({ "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)) });
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
  return new Request(`https://example.test/api/admin/blog/${POST_ID}`, { method: "PATCH", headers, body: text });
}

function deleteRequest(ifMatch: string | null) {
  const headers = new Headers();
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
  return new Request(`https://example.test/api/admin/blog/${POST_ID}`, { method: "DELETE", headers });
}

test("Blog PATCH requires a valid If-Match and returns distinct missing-record responses", async () => {
  for (const header of [
    null,
    "1",
    'W/"1"',
    '"0"',
    '"-1"',
    '"1.5"',
    '"not-a-number"',
    '"9999999999"',
    '"2147483648"',
    '"99999999999999999999"',
  ]) {
    let writes = 0;
    const response = await handleBlogPostUpdate(updateRequest(header), POST_ID, {
      authorize: async () => null,
      update: async () => { writes += 1; return { kind: "missing" }; },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(writes, 0);
  }
  const missing = await handleBlogPostUpdate(updateRequest('"1"'), POST_ID, {
    authorize: async () => null,
    update: async () => ({ kind: "missing" }),
  });
  assert.equal(missing.status, 404);

  const conflict = await handleBlogPostUpdate(updateRequest('"1"'), POST_ID, {
    authorize: async () => null,
    update: async () => ({ kind: "conflict" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get("Cache-Control"), "no-store");
  assert.match((await conflict.json() as { error: string }).error, /changed since you opened/u);

  let updateCalled = false;
  const denied = await handleBlogPostUpdate(updateRequest('"1"'), POST_ID, {
    authorize: async () => new Response(JSON.stringify({ error: "Denied." }), { status: 403 }),
    update: async () => { updateCalled = true; return { kind: "missing" }; },
  });
  assert.equal(denied.status, 403);
  assert.equal(updateCalled, false);
});

test("Blog CAS increments the row, returns its new version, and preserves omitted taxonomy and publication history", async () => {
  const fake = blogTransaction();
  const result = await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Edited body" }, 1, NOW);
  assert.equal(result.kind, "updated");
  if (result.kind !== "updated") return;
  assert.equal(result.post.version, 2);
  assert.equal(result.post.body, "Edited body");
  assert.equal(result.post.publishedAt?.getTime(), PUBLISHED_AT.getTime());
  assert.deepEqual(fake.relationWrites, { categoryChecks: 0, tagDeletes: 0, tagCreates: 0 });

  let expectedVersion = 0;
  const response = await handleBlogPostUpdate(updateRequest('"2"'), POST_ID, {
    authorize: async () => null,
    update: async (_id, _data, version) => {
      expectedVersion = version;
      return { kind: "updated", post: { ...result.post, version: 3 } as never };
    },
    now: () => NOW,
  });
  assert.equal(response.status, 200);
  assert.equal(expectedVersion, 2);
  assert.equal(response.headers.get("ETag"), '"3"');
  assert.equal((await response.json() as { post: { version: number } }).post.version, 3);
});

test("sequential Blog clients preserve the first content and taxonomy update when the second submits stale V1", async () => {
  const fake = blogTransaction();
  const clientA = await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Client A content" }, 1, NOW);
  assert.equal(clientA.kind, "updated");

  const clientB: BlogPostInputData = {
    body: "Stale client B content",
    categoryId: null,
    tagIds: [],
  };
  const stale = await updateBlogPostInTransaction(fake.transaction, POST_ID, clientB, 1, NOW);
  assert.deepEqual(stale, { kind: "conflict" });
  assert.equal(fake.getRow().body, "Client A content");
  assert.equal(fake.getRow().version, 2);
  assert.deepEqual(fake.relationWrites, { categoryChecks: 0, tagDeletes: 0, tagCreates: 0 });

  const legitimateFollowup = await updateBlogPostInTransaction(
    fake.transaction,
    POST_ID,
    { body: "Client A follow-up" },
    2,
    NOW,
  );
  assert.equal(legitimateFollowup.kind, "updated");
  assert.equal(fake.getRow().version, 3);
});

test("Blog taxonomy changes are written only after the matching version wins CAS", async () => {
  const fake = blogTransaction();
  const updated = await updateBlogPostInTransaction(
    fake.transaction,
    POST_ID,
    { categoryId: CATEGORY_ID, tagIds: [TAG_ID] },
    1,
    NOW,
  );
  assert.equal(updated.kind, "updated");
  assert.deepEqual(fake.relationWrites, { categoryChecks: 0, tagDeletes: 1, tagCreates: 1 });
  assert.equal(updated.kind === "updated" ? updated.post.tags[0]?.tag.id : null, TAG_ID);

  const staleFake = blogTransaction();
  await updateBlogPostInTransaction(staleFake.transaction, POST_ID, { body: "Winner" }, 1, NOW);
  const stale = await updateBlogPostInTransaction(
    staleFake.transaction,
    POST_ID,
    { categoryId: null, tagIds: [TAG_ID] },
    1,
    NOW,
  );
  assert.deepEqual(stale, { kind: "conflict" });
  assert.deepEqual(staleFake.relationWrites, { categoryChecks: 0, tagDeletes: 0, tagCreates: 0 });
});

test("change-and-revert still advances the Blog version and rejects an old form", async () => {
  const fake = blogTransaction();
  await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Temporary change" }, 1, NOW);
  await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Original body" }, 2, NOW);
  assert.equal(fake.getRow().body, "Original body");
  assert.equal(fake.getRow().version, 3);
  assert.deepEqual(
    await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Stale edit" }, 1, NOW),
    { kind: "conflict" },
  );
  assert.equal(fake.getRow().body, "Original body");
});

test("Blog publication initializes once and remains unchanged through archive and republication", async () => {
  const fake = blogTransaction({ initial: { status: "DRAFT", publishedAt: null } });
  const firstPublish = await updateBlogPostInTransaction(
    fake.transaction,
    POST_ID,
    { status: "PUBLISHED" },
    1,
    NOW,
  );
  assert.equal(firstPublish.kind, "updated");
  if (firstPublish.kind !== "updated") return;
  assert.equal(firstPublish.post.publishedAt?.getTime(), NOW.getTime());

  const archived = await updateBlogPostInTransaction(
    fake.transaction,
    POST_ID,
    { status: "ARCHIVED" },
    2,
    new Date("2027-01-01T00:00:00.000Z"),
  );
  assert.equal(archived.kind, "updated");
  if (archived.kind !== "updated") return;
  assert.equal(archived.post.publishedAt?.getTime(), NOW.getTime());

  const republished = await updateBlogPostInTransaction(
    fake.transaction,
    POST_ID,
    { status: "PUBLISHED" },
    3,
    new Date("2028-01-01T00:00:00.000Z"),
  );
  assert.equal(republished.kind, "updated");
  if (republished.kind === "updated") assert.equal(republished.post.publishedAt?.getTime(), NOW.getTime());
});

test("overlapping Blog updates allow only one atomic compare-and-swap", async () => {
  const fake = blogTransaction({ barrier: true });
  const [first, second] = await Promise.all([
    updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Concurrent A" }, 1, NOW),
    updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Concurrent B" }, 1, NOW),
  ]);
  assert.deepEqual([first.kind, second.kind].sort(), ["conflict", "updated"]);
  assert.equal(fake.getRow().version, 2);
  assert.ok(["Concurrent A", "Concurrent B"].includes(fake.getRow().body));
});

test("Blog form sends If-Match, adopts returned versions, and preserves submitted values on conflict without retry", async () => {
  const calls: Array<{ headers: Headers; body: string }> = [];
  const payload: BlogPostInputData = { body: "Unsaved content" };
  let responseVersion = 2;
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(JSON.stringify({ post: postItem({ version: responseVersion }) }), { status: 200 });
  };

  const first = await saveBlogPostRecord(postItem(), payload, fetcher);
  assert.equal(first.ok, true);
  assert.equal(calls[0]?.headers.get("If-Match"), '"1"');
  if (!first.ok) return;
  responseVersion = 3;
  const second = await saveBlogPostRecord(first.post, payload, fetcher);
  assert.equal(second.ok, true);
  assert.equal(calls[1]?.headers.get("If-Match"), '"2"');

  const conflictCalls: Headers[] = [];
  const conflict = await saveBlogPostRecord(postItem(), payload, async (_input, init) => {
    conflictCalls.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ error: "Stale post." }), { status: 409 });
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflictCalls.length, 1);
  assert.equal(JSON.parse(calls[0]!.body).body, "Unsaved content");
  assert.equal(payload.body, "Unsaved content");
});

test("Blog creation does not require an If-Match token", async () => {
  let header: string | null = null;
  const result = await saveBlogPostRecord(null, { body: "New post body" }, async (_input, init) => {
    header = new Headers(init?.headers).get("If-Match");
    return new Response(JSON.stringify({ post: postItem() }), { status: 201 });
  });
  assert.equal(result.ok, true);
  assert.equal(header, null);
});

test("Blog compare-and-swap reports a row deleted before the update as missing", async () => {
  const fake = blogTransaction();
  fake.setExists(false);
  assert.deepEqual(
    await updateBlogPostInTransaction(fake.transaction, POST_ID, { body: "Update" }, 1, NOW),
    { kind: "missing" },
  );
});

test("Blog DELETE requires a strong positive If-Match value before attempting deletion", async () => {
  for (const header of [null, "1", 'W/"1"', '"0"', '"-1"', '"1.5"', '"abc"', '"2147483648"']) {
    let deleteCalls = 0;
    const response = await handleBlogPostDelete(deleteRequest(header), POST_ID, {
      authorize: async () => null,
      delete: async () => { deleteCalls += 1; return { kind: "deleted" }; },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(deleteCalls, 0);
  }
});

test("Blog DELETE atomically removes only the matching ID and version, distinguishing stale and missing Posts", async () => {
  let current: { id: string; version: number } | null = { id: POST_ID, version: 2 };
  const calls: unknown[] = [];
  const transaction = {
    post: {
      deleteMany: async ({ where }: { where: { id: string; version: number } }) => {
        calls.push(where);
        if (!current || current.id !== where.id || current.version !== where.version) return { count: 0 };
        current = null;
        return { count: 1 };
      },
      findUnique: async () => current ? { id: current.id } : null,
    },
  } as never;
  const routeDependencies = {
    authorize: async () => null,
    delete: (id: string, version: number) => deleteBlogPostWithVersion(transaction, id, version),
  };

  const stale = await handleBlogPostDelete(deleteRequest('"1"'), POST_ID, routeDependencies);
  assert.equal(stale.status, 409);
  assert.equal(current?.version, 2, "the stale delete does not remove or alter the Post");
  assert.deepEqual(calls, [{ id: POST_ID, version: 1 }]);

  const success = await handleBlogPostDelete(deleteRequest('"2"'), POST_ID, routeDependencies);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("Cache-Control"), "no-store");
  assert.equal(current, null);
  assert.deepEqual(calls[1], { id: POST_ID, version: 2 });
  assert.deepEqual(await success.json(), { success: true });

  const missing = await handleBlogPostDelete(deleteRequest('"2"'), POST_ID, routeDependencies);
  assert.equal(missing.status, 404);
});

test("Blog DELETE client sends the loaded version and preserves local state on stale response without retry", async () => {
  const post = postItem({ version: 6 });
  let calls = 0;
  let sentIfMatch: string | null = null;
  const stale = await deleteBlogPostRecord(post, async (_input, init) => {
    calls += 1;
    sentIfMatch = new Headers(init?.headers).get("If-Match");
    return Response.json({ error: "This post changed since it was listed." }, { status: 409 });
  });
  assert.equal(stale.ok, false);
  assert.equal(sentIfMatch, '"6"');
  assert.equal(calls, 1);
  assert.equal(post.id, POST_ID);
  assert.equal(post.version, 6);

  const success = await deleteBlogPostRecord(post, async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("If-Match"), '"6"');
    return Response.json({ success: true });
  });
  assert.equal(success.ok, true);
});
