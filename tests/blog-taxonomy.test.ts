import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deleteBlogCategoryWithPosts,
  deleteBlogTagWithAssociations,
  isBlogTaxonomyUniqueConflict,
} from "../src/lib/blog-taxonomy-content";
import { deleteBlogTaxonomy, saveBlogTaxonomy } from "../src/lib/blog-taxonomy-client";
import { createBlogOperationCoordinator } from "../src/lib/blog-operation-coordinator";
import {
  getBlogPostEditorRelations,
  removeBlogCategoryFromPosts,
  removeBlogTagFromPosts,
  syncBlogPostCategoryLabel,
  syncBlogPostTagLabel,
  upsertAdminBlogCategory,
  upsertAdminBlogTag,
} from "../src/lib/blog-taxonomy-state";
import {
  createBlogCategorySlug,
  createBlogTagSlug,
  isValidBlogTaxonomyId,
  parseBlogCategoryInput,
  parseBlogTagInput,
} from "../src/lib/blog-taxonomy-validation";
import { deleteBlogPostRecord, saveBlogPostRecord } from "../src/lib/blog-form";
import {
  loadAdminBlogData,
  loadAndAdoptAdminBlogData,
  parseAdminBlogDataResponse,
  type AdminBlogDataSnapshot,
} from "../src/lib/blog-admin-client";
import { recoverBlogTaxonomyDelete } from "../src/lib/blog-taxonomy-recovery";
import type { AdminBlogPostItem } from "../src/lib/blog-types";

const CATEGORY_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51a";
const TAG_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51b";

test("category validation accepts editable slugs and bounds all category fields", () => {
  const valid = parseBlogCategoryInput({
    name: "  Engineering  ",
    slug: "engineering-notes",
    description: "Notes about building software.",
    sortOrder: 12,
  });
  assert.deepEqual(valid.data, {
    name: "Engineering",
    slug: "engineering-notes",
    description: "Notes about building software.",
    sortOrder: 12,
  });

  assert.equal(parseBlogCategoryInput({ slug: "category", sortOrder: 0 }).errors.name, "Category name is required.");
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "Bad Slug", description: null, sortOrder: 0 }).errors.slug);
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: null, sortOrder: -1 }).errors.sortOrder);
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: "x".repeat(501), sortOrder: 0 }).errors.description);
  assert.equal(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: null, sortOrder: 0, extra: true }).invalidShape, true);
});

test("tag validation accepts valid values and rejects missing names or malformed slugs", () => {
  assert.deepEqual(parseBlogTagInput({ name: "TypeScript", slug: "typescript" }).data, {
    name: "TypeScript",
    slug: "typescript",
  });
  assert.equal(parseBlogTagInput({ name: " ", slug: "typescript" }).errors.name, "Tag name is required.");
  assert.ok(parseBlogTagInput({ name: "TypeScript", slug: "Type Script" }).errors.slug);
  assert.equal(parseBlogTagInput({ name: "TypeScript", slug: "typescript", description: "not allowed" }).invalidShape, true);
});

test("taxonomy slug suggestions share the site's URL-friendly normalization", () => {
  assert.equal(createBlogCategorySlug("Café Notes"), "cafe-notes");
  assert.equal(createBlogTagSlug("Next.js 16"), "next-js-16");
  assert.equal(isValidBlogTaxonomyId(CATEGORY_ID), true);
  assert.equal(isValidBlogTaxonomyId("not-a-uuid"), false);
});

test("unique name and slug constraints become safe conflict responses", () => {
  assert.equal(isBlogTaxonomyUniqueConflict({ code: "P2002" }), true);
  assert.equal(isBlogTaxonomyUniqueConflict({ code: "P2025" }), false);
});

test("category deletion reports affected posts and deletes only the category row", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock-category");
      return [{ id: CATEGORY_ID, name: "Engineering" }];
    },
    post: {
      updateManyAndReturn: async (args: unknown) => {
        calls.push("bump-post-versions");
        assert.deepEqual(args, {
          where: { categoryId: CATEGORY_ID },
          data: { version: { increment: 1 } },
          select: { id: true, version: true },
        });
        return [
          { id: "post-a", version: 2 },
          { id: "post-b", version: 4 },
          { id: "post-c", version: 2 },
        ];
      },
    },
    postCategory: { delete: async () => { calls.push("delete-category"); } },
  } as never;

  const result = await deleteBlogCategoryWithPosts(transaction, CATEGORY_ID);
  assert.deepEqual(result, {
    name: "Engineering",
    detachedPostCount: 3,
    affectedPosts: [
      { id: "post-a", version: 2 },
      { id: "post-b", version: 4 },
      { id: "post-c", version: 2 },
    ],
  });
  assert.deepEqual(calls, ["lock-category", "bump-post-versions", "delete-category"]);
});

test("tag deletion counts and cascades associations without deleting posts", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock-tag");
      return [{ id: TAG_ID, name: "TypeScript" }];
    },
    postTag: {
      count: async () => { calls.push("count-associations"); return 2; },
      findMany: async () => { calls.push("find-posts"); return [{ postId: "post-a" }, { postId: "post-a" }, { postId: "post-b" }]; },
    },
    post: {
      updateManyAndReturn: async (args: unknown) => {
        calls.push("bump-post-versions");
        assert.deepEqual(args, {
          where: { id: { in: ["post-a", "post-b"] } },
          data: { version: { increment: 1 } },
          select: { id: true, version: true },
        });
        return [{ id: "post-a", version: 2 }, { id: "post-b", version: 5 }];
      },
    },
    tag: { delete: async () => { calls.push("delete-tag"); } },
  } as never;

  const result = await deleteBlogTagWithAssociations(transaction, TAG_ID);
  assert.deepEqual(result, {
    name: "TypeScript",
    removedAssociationCount: 2,
    affectedPosts: [{ id: "post-a", version: 2 }, { id: "post-b", version: 5 }],
  });
  assert.deepEqual(calls, ["lock-tag", "count-associations", "find-posts", "bump-post-versions", "delete-tag"]);
});

test("new and edited taxonomy is reflected in the post editor and existing post associations", () => {
  const category = {
    id: CATEGORY_ID,
    name: "Engineering",
    slug: "engineering",
    description: null,
    sortOrder: 0,
    postCount: 1,
  };
  const tag = { id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 1 };
  const initialPost: AdminBlogPostItem = {
    id: "post-1",
    version: 1,
    title: "Typed notes",
    slug: "typed-notes",
    excerpt: null,
    body: "Plain text",
    status: "DRAFT" as const,
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
  };
  const unaffectedPost: AdminBlogPostItem = {
    ...initialPost,
    id: "post-2",
    version: 7,
    title: "Unrelated post",
    categoryId: null,
    category: null,
    tags: [],
  };
  const initialPosts = [initialPost, unaffectedPost];

  assert.equal(upsertAdminBlogCategory([], category)[0]?.id, CATEGORY_ID);
  assert.equal(upsertAdminBlogTag([], tag)[0]?.id, TAG_ID);
  assert.deepEqual(getBlogPostEditorRelations(initialPosts[0]!), { categoryId: CATEGORY_ID, tagIds: [TAG_ID] });

  const renamedCategory = { ...category, name: "Software" };
  const renamedTag = { ...tag, name: "TS" };
  const renamedPosts = syncBlogPostTagLabel(
    syncBlogPostCategoryLabel(initialPosts, renamedCategory),
    renamedTag,
  );
  assert.equal(renamedPosts[0]?.category?.name, "Software");
  assert.equal(renamedPosts[0]?.tags[0]?.name, "TS");
  assert.equal(renamedPosts[0]?.categoryId, CATEGORY_ID);
  assert.deepEqual(renamedPosts[0]?.tags.map(({ id }) => id), [TAG_ID]);

  const afterCategoryDelete = removeBlogCategoryFromPosts(renamedPosts, CATEGORY_ID, [
    { id: "post-1", version: 2 },
  ]);
  assert.equal(afterCategoryDelete[0]?.version, 2);
  assert.equal(afterCategoryDelete[1]?.version, 7);
  assert.equal(afterCategoryDelete[0]?.title, "Typed notes");
  assert.equal(afterCategoryDelete[0]?.categoryId, null);
  assert.deepEqual(afterCategoryDelete[0]?.tags.map(({ id }) => id), [TAG_ID]);
  assert.equal(afterCategoryDelete[1], renamedPosts[1]);

  const postsAfterDeletion = removeBlogTagFromPosts(afterCategoryDelete, TAG_ID, [
    { id: "post-1", version: 3 },
  ]);
  assert.equal(postsAfterDeletion[0]?.id, "post-1");
  assert.equal(postsAfterDeletion[0]?.version, 3);
  assert.equal(postsAfterDeletion[0]?.categoryId, null);
  assert.deepEqual(postsAfterDeletion[0]?.tags, []);
  assert.equal(postsAfterDeletion[1]?.version, 7);
  assert.equal(postsAfterDeletion[1], afterCategoryDelete[1]);
});

test("taxonomy deletion validates committed versions without mutating the local Post cache", async () => {
  const post: AdminBlogPostItem = {
    id: "44444444-4444-4444-8444-444444444444",
    version: 1,
    title: "Post",
    slug: "post",
    excerpt: null,
    body: "Body",
    status: "DRAFT",
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  const cachedPosts = [post];
  const failed = await deleteBlogTaxonomy("category", CATEGORY_ID, async () =>
    Response.json({ error: "Deletion failed." }, { status: 500 }));
  assert.equal(failed.ok, false);
  assert.equal(cachedPosts[0]?.version, 1);
  assert.equal(cachedPosts[0]?.categoryId, CATEGORY_ID);

  const successful = await deleteBlogTaxonomy("category", CATEGORY_ID, async () => Response.json({
    success: true,
    detachedPostCount: 1,
    affectedPosts: [{ id: post.id, version: 2 }],
  }));
  assert.equal(successful.ok, true);
  if (!successful.ok) return;
  assert.deepEqual(successful.affectedPosts, [{ id: post.id, version: 2 }]);
  assert.equal(cachedPosts[0]?.version, 1, "cache is not reconciled from the response list");
  assert.equal(cachedPosts[0]?.categoryId, CATEGORY_ID);
});

test("failed or malformed taxonomy deletion responses never expose affected versions", async () => {
  const failed = await deleteBlogTaxonomy("tag", TAG_ID, async () =>
    Response.json({ error: "Unable to delete." }, { status: 409 }));
  assert.equal(failed.ok, false);
  if (!failed.ok) assert.equal(failed.mutationMayHaveSucceeded, false);

  const serverFailure = await deleteBlogTaxonomy("tag", TAG_ID, async () =>
    Response.json({ error: "Unable to delete." }, { status: 500 }));
  assert.equal(serverFailure.ok, false);
  if (!serverFailure.ok) assert.equal(serverFailure.mutationMayHaveSucceeded, true);

  const timeout = await deleteBlogTaxonomy("tag", TAG_ID, async () =>
    Response.json({ error: "Request timed out." }, { status: 408 }));
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.mutationMayHaveSucceeded, true);

  const malformedCases = [
    { success: true, removedAssociationCount: 1, affectedPosts: [{ id: "post-a", version: 2 }] },
    { success: true, removedAssociationCount: 2, affectedPosts: [{ id: CATEGORY_ID, version: 2 }] },
    { success: true, removedAssociationCount: 2, affectedPosts: [{ id: CATEGORY_ID, version: 2 }, { id: CATEGORY_ID, version: 3 }] },
    { success: true, removedAssociationCount: 1, affectedPosts: [{ id: TAG_ID, version: 0 }] },
  ];
  for (const body of malformedCases) {
    const malformed = await deleteBlogTaxonomy("tag", TAG_ID, async () => Response.json(body));
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.equal(malformed.mutationMayHaveSucceeded, true);
  }

  const networkFailure = await deleteBlogTaxonomy("tag", TAG_ID, async () => {
    throw new Error("connection closed after request");
  });
  assert.equal(networkFailure.ok, false);
  if (!networkFailure.ok) assert.equal(networkFailure.mutationMayHaveSucceeded, true);
});

test("taxonomy responses are validated before category or tag state can be reconciled", async () => {
  const malformedCategory = await saveBlogTaxonomy("category", null, {}, async () =>
    Response.json({ category: { id: CATEGORY_ID, name: "Incomplete" } }));
  const malformedTag = await saveBlogTaxonomy("tag", null, {}, async () =>
    Response.json({ tag: { id: TAG_ID, name: "Incomplete", slug: "incomplete", postCount: "1" } }));

  assert.equal(malformedCategory.ok, false);
  assert.equal(malformedTag.ok, false);

  const validCategory = {
    id: CATEGORY_ID,
    name: "Engineering",
    slug: "engineering",
    description: null,
    sortOrder: 0,
    postCount: 0,
  };
  const valid = await saveBlogTaxonomy("category", null, {}, async () =>
    Response.json({ category: validCategory }));
  assert.deepEqual(valid, { ok: true, category: validCategory });
});

test("taxonomy PATCH response identity must match the requested UUID", async () => {
  const category = {
    id: CATEGORY_ID,
    name: "Engineering",
    slug: "engineering",
    description: null,
    sortOrder: 0,
    postCount: 0,
  };
  const tag = { id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 0 };
  assert.equal((await saveBlogTaxonomy("category", CATEGORY_ID, {}, async () =>
    Response.json({ category: { ...category, id: TAG_ID } }))).ok, false);
  assert.equal((await saveBlogTaxonomy("tag", TAG_ID, {}, async () =>
    Response.json({ tag: { ...tag, id: "not-a-uuid" } }))).ok, false);
  assert.equal((await saveBlogTaxonomy("category", CATEGORY_ID, {}, async () =>
    Response.json({ category }))).ok, true);
  assert.equal((await saveBlogTaxonomy("tag", null, {}, async () =>
    Response.json({ tag }))).ok, true);
});

test("authoritative Blog refresh accepts complete data and provides a retry after read failure", async () => {
  const post = {
    id: "44444444-4444-4444-8444-444444444444",
    version: 2,
    title: "Post",
    slug: "post",
    excerpt: null,
    body: "Body",
    status: "DRAFT",
    publishedAt: null,
    categoryId: null,
    category: null,
    tags: [],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  const snapshot = {
    posts: [post],
    categories: [{ id: CATEGORY_ID, name: "Engineering", slug: "engineering", description: null, sortOrder: 0, postCount: 0 }],
    tags: [{ id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 0 }],
  };
  assert.deepEqual(parseAdminBlogDataResponse(snapshot), snapshot);
  assert.equal(parseAdminBlogDataResponse({ ...snapshot, posts: [{ ...post, version: 0 }] }), null);

  const first = await loadAdminBlogData(async () => Response.json({ error: "Unavailable." }, { status: 500 }));
  assert.equal(first.ok, false);
  const retry = await loadAdminBlogData(async (_input, init) => {
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    return Response.json(snapshot);
  });
  assert.deepEqual(retry, { ok: true, data: snapshot });
});

test("authoritative Blog refresh reads all collections in one repeatable-read transaction", async () => {
  const source = await readFile(new URL("../src/app/api/admin/blog/route.ts", import.meta.url), "utf8");
  const getHandler = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function POST"));

  assert.match(getHandler, /prisma\.\$transaction\(/u);
  assert.match(getHandler, /transaction\.post\.findMany/u);
  assert.match(getHandler, /transaction\.postCategory\.findMany/u);
  assert.match(getHandler, /transaction\.tag\.findMany/u);
  assert.match(getHandler, /isolationLevel:\s*"RepeatableRead"/u);
});

test("a pending Post save blocks taxonomy mutations and duplicate Post operations", async () => {
  const coordinator = createBlogOperationCoordinator();
  let finishSave: (() => void) | undefined;
  const save = coordinator.run("post", () => new Promise<void>((resolve) => { finishSave = resolve; }));
  let taxonomyRequests = 0;
  const fetcher: typeof fetch = async () => {
    taxonomyRequests += 1;
    return Response.json({});
  };
  const taxonomyActions: Array<() => Promise<unknown>> = [
    () => saveBlogTaxonomy("category", null, {}, fetcher),
    () => saveBlogTaxonomy("category", CATEGORY_ID, {}, fetcher),
    () => saveBlogTaxonomy("tag", null, {}, fetcher),
    () => saveBlogTaxonomy("tag", TAG_ID, {}, fetcher),
    () => deleteBlogTaxonomy("category", CATEGORY_ID, fetcher),
    () => deleteBlogTaxonomy("tag", TAG_ID, fetcher),
  ];

  assert.equal(coordinator.isBusy(), true);
  for (const action of taxonomyActions) {
    assert.deepEqual(await coordinator.run("taxonomy", action), { started: false });
  }
  assert.deepEqual(await coordinator.run("post", async () => "duplicate"), { started: false });
  assert.equal(taxonomyRequests, 0, "blocked create, edit, and delete handlers never call the API");

  finishSave?.();
  assert.deepEqual(await save, { started: true, value: undefined });
  assert.equal(coordinator.isBusy(), false);
});

test("a pending taxonomy mutation blocks Post saves", async () => {
  const coordinator = createBlogOperationCoordinator();
  let finishTaxonomy: (() => void) | undefined;
  const mutation = coordinator.run("taxonomy", () => new Promise<void>((resolve) => { finishTaxonomy = resolve; }));
  let postRequests = 0;
  const fetcher: typeof fetch = async () => {
    postRequests += 1;
    return Response.json({});
  };
  const postActions = [
    () => saveBlogPostRecord(null, {}, fetcher),
    () => saveBlogPostRecord({ id: "post-id", version: 1 }, {}, fetcher),
    () => deleteBlogPostRecord({ id: "post-id", version: 1 }, fetcher),
  ];

  for (const action of postActions) {
    assert.deepEqual(await coordinator.run("post", action), { started: false });
  }
  assert.deepEqual(await coordinator.run("taxonomy", async () => "duplicate"), { started: false });
  assert.equal(postRequests, 0, "blocked create and update handlers never call the API");
  finishTaxonomy?.();
  await mutation;
  assert.equal(coordinator.isBusy(), false);
});

test("operation locks release after success, HTTP errors, malformed responses, and network failures", async () => {
  const coordinator = createBlogOperationCoordinator();
  const outcomes = [
    async () => Response.json({ category: {
      id: CATEGORY_ID, name: "Engineering", slug: "engineering", description: null, sortOrder: 0, postCount: 0,
    } }),
    async () => Response.json({ error: "Conflict." }, { status: 409 }),
    async () => Response.json({ category: { id: CATEGORY_ID } }),
    async () => { throw new Error("network unavailable"); },
  ];

  for (const fetcher of outcomes) {
    const run = await coordinator.run("taxonomy", () => saveBlogTaxonomy("category", null, {}, fetcher));
    assert.equal(run.started, true);
    assert.equal(coordinator.isBusy(), false);
    assert.deepEqual(await coordinator.run("post", async () => "available again"), {
      started: true,
      value: "available again",
    });
  }
});

test("Post-save locks release after successful, rejected, malformed, and network responses", async () => {
  const coordinator = createBlogOperationCoordinator();
  const validPost = {
    id: "post-save-result",
    version: 2,
  };
  const responses = [
    async () => Response.json({ post: validPost }),
    async () => Response.json({ error: "Validation failed." }, { status: 422 }),
    async () => Response.json({ post: { id: validPost.id, version: 0 } }),
    async () => { throw new Error("network unavailable"); },
  ];

  for (const fetcher of responses) {
    const run = await coordinator.run("post", () => saveBlogPostRecord(null, {}, fetcher));
    assert.equal(run.started, true);
    assert.equal(coordinator.isBusy(), false);
    assert.deepEqual(await coordinator.run("taxonomy", async () => "available again"), {
      started: true,
      value: "available again",
    });
  }
});

test("taxonomy deletion holds the shared lock through authoritative refresh, then saves with the refreshed version", async () => {
  const coordinator = createBlogOperationCoordinator();
  const post: AdminBlogPostItem = {
    id: "55555555-5555-4555-8555-555555555555",
    version: 1,
    title: "Post",
    slug: "post",
    excerpt: null,
    body: "Body",
    status: "DRAFT",
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  let cachedPosts = [post];
  let resolveDeleteResponse: ((response: Response) => void) | undefined;
  let resolveRefreshResponse: ((response: Response) => void) | undefined;
  const deletion = coordinator.run("taxonomy", async () => {
    const response = await deleteBlogTaxonomy(
      "category",
      CATEGORY_ID,
      () => new Promise<Response>((resolve) => { resolveDeleteResponse = resolve; }),
    );
    if (!response.ok) return false;
    const refreshed = await loadAdminBlogData(
      () => new Promise<Response>((resolve) => { resolveRefreshResponse = resolve; }),
    );
    if (refreshed.ok) cachedPosts = refreshed.data.posts;
    return refreshed.ok;
  });

  assert.deepEqual(await coordinator.run("post", async () => "stale submit"), { started: false });
  resolveDeleteResponse?.(Response.json({
    success: true,
    detachedPostCount: 1,
    affectedPosts: [{ id: post.id, version: 2 }],
  }));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(coordinator.isBusy(), true, "the mutation lock remains held during authoritative refresh");
  assert.deepEqual(await coordinator.run("post", async () => "stale submit"), { started: false });
  resolveRefreshResponse?.(Response.json({
    posts: [{ ...post, version: 2, categoryId: null, category: null, tags: [] }],
    categories: [],
    tags: [{ id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 0 }],
  }));
  const deleted = await deletion;
  assert.equal(deleted.started, true);
  assert.equal(deleted.value, true);
  assert.equal(cachedPosts[0]?.version, 2);
  assert.equal(cachedPosts[0]?.categoryId, null);
  assert.equal(cachedPosts[0]?.category, null);

  let ifMatch: string | null = null;
  const nextSave = await coordinator.run("post", async () => {
    const saved = await saveBlogPostRecord(cachedPosts[0]!, { categoryId: null }, async (_input, init) => {
      ifMatch = new Headers(init?.headers).get("If-Match");
      return Response.json({ post: { ...cachedPosts[0]!, version: 3 } });
    });
    if (saved.ok) cachedPosts = [saved.post];
    return saved;
  });

  assert.equal(nextSave.started, true);
  assert.equal(ifMatch, '"2"');
  assert.equal(cachedPosts[0]?.categoryId, null);
  assert.equal(cachedPosts[0]?.version, 3);
});

test("definite taxonomy 4xx preserves the authoritative cache and keeps the editor values while releasing its lock", async () => {
  const coordinator = createBlogOperationCoordinator();
  const cachedPost: AdminBlogPostItem = {
    id: "66666666-6666-4666-8666-666666666666",
    version: 4,
    title: "Saved title",
    slug: "saved-title",
    excerpt: null,
    body: "Saved body",
    status: "DRAFT",
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  const cache = { posts: [cachedPost] };
  const values = { title: "Unsaved title", body: "Unsaved body", categoryId: "", tagIds: [] as string[] };
  const originalValues = structuredClone(values);
  let refreshCalls = 0;
  let visibleError = "";
  let visibleSuccess = "";

  const attempt = await coordinator.run("taxonomy", async () => {
    const outcome = await recoverBlogTaxonomyDelete(
      () => deleteBlogTaxonomy("category", CATEGORY_ID, async () =>
        Response.json({ error: "Category still contains posts." }, { status: 409 })),
      async () => { refreshCalls += 1; return true; },
    );
    if (outcome.outcome === "rejected") visibleError = outcome.error;
    else visibleSuccess = "Unexpected success";
    return outcome;
  });

  assert.equal(attempt.started, true);
  assert.equal(attempt.value?.outcome, "rejected");
  assert.match(visibleError, /contains posts/u);
  assert.equal(visibleSuccess, "");
  assert.equal(refreshCalls, 0, "a definite 4xx does not trigger recovery refresh");
  assert.equal(cache.posts[0], cachedPost);
  assert.deepEqual(values, originalValues);
  assert.equal(coordinator.isBusy(), false);

  const postUpdate = await coordinator.run("post", async () => {
    const result = await saveBlogPostRecord(cachedPost, {
      title: values.title,
      slug: "unsaved-title",
      excerpt: null,
      body: values.body,
      categoryId: null,
      tagIds: values.tagIds,
      status: "DRAFT",
    }, async () => Response.json({ error: "Validation failed." }, { status: 422 }));
    if (!result.ok) {
      visibleError = result.error;
      return false;
    }
    visibleSuccess = "Post updated.";
    cache.posts = [result.post];
    return true;
  });
  assert.equal(postUpdate.started, true);
  assert.equal(postUpdate.value, false);
  assert.equal(visibleError, "Validation failed.");
  assert.equal(visibleSuccess, "");
  assert.equal(cache.posts[0], cachedPost);
  assert.deepEqual(values, originalValues);
  assert.equal(coordinator.isBusy(), false);
});

test("ambiguous taxonomy deletion preserves stale cached data on refresh failure, then retry adopts one complete snapshot", async () => {
  const coordinator = createBlogOperationCoordinator();
  const originalPost: AdminBlogPostItem = {
    id: "77777777-7777-4777-8777-777777777777",
    version: 1,
    title: "Post before deletion",
    slug: "post-before-deletion",
    excerpt: null,
    body: "Body",
    status: "DRAFT",
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
  };
  const initialSnapshot = {
    posts: [originalPost],
    categories: [{ id: CATEGORY_ID, name: "Engineering", slug: "engineering", description: null, sortOrder: 0, postCount: 1 }],
    tags: [{ id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 1 }],
  };
  const authoritativeSnapshot = {
    posts: [{ ...originalPost, version: 2, categoryId: null, category: null, tags: [] }],
    categories: [],
    tags: [],
  };
  let cached: AdminBlogDataSnapshot = initialSnapshot;
  let needsRefresh = false;
  let recoveryMessage = "";
  let deletionRequests = 0;
  let refreshCalls = 0;

  const first = await coordinator.run("taxonomy", async () => {
    needsRefresh = true;
    const result = await recoverBlogTaxonomyDelete(
      async () => {
        deletionRequests += 1;
        return deleteBlogTaxonomy("category", CATEGORY_ID, async () =>
          Response.json({ error: "Upstream failed after handling the request." }, { status: 502 }));
      },
      async (deletionConfirmed) => {
        assert.equal(deletionConfirmed, false);
        refreshCalls += 1;
        const loaded = await loadAndAdoptAdminBlogData((snapshot) => { cached = snapshot; }, async () =>
          Response.json({ posts: [], categories: "incomplete", tags: [] }));
        if (!loaded.ok) {
          recoveryMessage = "The deletion outcome is uncertain; retry the Blog data refresh.";
          return false;
        }
        needsRefresh = false;
        return true;
      },
    );
    assert.equal(result.outcome, "refresh-failed");
    return result;
  });

  assert.equal(first.started, true);
  assert.equal(coordinator.isBusy(), false, "the active request lock releases after failed recovery");
  assert.equal(needsRefresh, true, "the separate stale-data guard remains active");
  assert.match(recoveryMessage, /outcome is uncertain/u);
  assert.equal(cached, initialSnapshot, "incomplete server data cannot replace the cached snapshot");
  assert.equal(deletionRequests, 1);

  let retryWasLocked = false;
  const retry = await coordinator.run("taxonomy", async () => {
    const loaded = await loadAndAdoptAdminBlogData((snapshot) => { cached = snapshot; }, async () => {
      retryWasLocked = coordinator.isBusy();
      refreshCalls += 1;
      return Response.json(authoritativeSnapshot);
    });
    if (loaded.ok) {
      needsRefresh = false;
      recoveryMessage = "";
    }
    return loaded.ok;
  });

  assert.equal(retry.started, true);
  assert.equal(retry.value, true);
  assert.equal(retryWasLocked, true);
  assert.equal(needsRefresh, false);
  assert.equal(recoveryMessage, "");
  assert.equal(cached.posts[0]?.version, 2);
  assert.equal(cached.posts[0]?.categoryId, null);
  assert.deepEqual(cached.posts[0]?.tags, []);
  assert.deepEqual(cached.categories, []);
  assert.deepEqual(cached.tags, []);
  assert.equal(deletionRequests, 1, "recovery retry refreshes instead of repeating the delete");
  assert.equal(refreshCalls, 2);
  assert.equal(coordinator.isBusy(), false);

  const nextMutation = await coordinator.run("post", async () => "available after reconciliation");
  assert.deepEqual(nextMutation, { started: true, value: "available after reconciliation" });
});

test("confirmed taxonomy deletion refreshes before reporting success and keeps the lock through refresh", async () => {
  const coordinator = createBlogOperationCoordinator();
  let busyDuringRefresh = false;
  const result = await coordinator.run("taxonomy", () => recoverBlogTaxonomyDelete(
    () => deleteBlogTaxonomy("tag", TAG_ID, async () => Response.json({
      success: true,
      removedAssociationCount: 0,
      affectedPosts: [],
    })),
    async (deletionConfirmed) => {
      busyDuringRefresh = coordinator.isBusy();
      assert.equal(deletionConfirmed, true);
      return true;
    },
  ));
  assert.equal(result.started, true);
  if (!result.started) return;
  assert.equal(result.value?.outcome, "deleted");
  assert.equal(busyDuringRefresh, true);
  assert.equal(coordinator.isBusy(), false);
});

test("taxonomy network failure is treated as ambiguous and refresh failure after confirmed deletion remains recoverable", async () => {
  const coordinator = createBlogOperationCoordinator();
  let refreshCalls = 0;
  const networkFailure = await coordinator.run("taxonomy", () => recoverBlogTaxonomyDelete(
    async () => { throw new Error("connection ended after request delivery"); },
    async (deletionConfirmed) => {
      refreshCalls += 1;
      assert.equal(deletionConfirmed, false);
      return true;
    },
  ));
  assert.equal(networkFailure.started, true);
  if (!networkFailure.started) return;
  assert.equal(networkFailure.value?.outcome, "refreshed-uncertain");
  assert.equal(coordinator.isBusy(), false);

  const confirmedButUnrefreshed = await coordinator.run("taxonomy", () => recoverBlogTaxonomyDelete(
    async () => ({ ok: true, count: 0, affectedPosts: [] }),
    async (deletionConfirmed) => {
      refreshCalls += 1;
      assert.equal(deletionConfirmed, true);
      throw new Error("authoritative read failed");
    },
  ));
  assert.equal(confirmedButUnrefreshed.started, true);
  if (!confirmedButUnrefreshed.started) return;
  assert.deepEqual(confirmedButUnrefreshed.value, {
    outcome: "refresh-failed",
    deletionConfirmed: true,
  });
  assert.equal(refreshCalls, 2);
  assert.equal(coordinator.isBusy(), false);
});
