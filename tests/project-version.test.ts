import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectInputData } from "../src/lib/project-validation";
import { handleProjectDelete, handleProjectUpdate } from "../src/lib/project-management";
import {
  deleteProjectWithVersion,
  deleteSkillAndBumpProjectVersions,
  updateProjectInTransaction,
} from "../src/lib/project-content";
import { deleteProjectRecord, saveProjectRecord } from "../src/lib/project-form";
import type { AdminProjectItem } from "../src/lib/project-types";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SKILL_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-02T12:00:00.000Z");

function input(overrides: Partial<ProjectInputData> = {}): ProjectInputData {
  return {
    title: "Project title",
    slug: "project-title",
    summary: "Project summary",
    description: null,
    categoryId: null,
    featured: false,
    sortOrder: 0,
    status: "DRAFT",
    ...overrides,
  };
}

function item(overrides: Partial<AdminProjectItem> = {}): AdminProjectItem {
  return {
    id: PROJECT_ID,
    version: 1,
    categoryId: null,
    title: "Project title",
    slug: "project-title",
    summary: "Project summary",
    description: null,
    status: "DRAFT",
    featured: false,
    sortOrder: 0,
    category: null,
    skills: [],
    links: [],
    images: [],
    ...overrides,
  };
}

function projectTransaction(options: { barrier?: boolean; initial?: Partial<AdminProjectItem> } = {}) {
  let row: (AdminProjectItem & { publishedAt: Date | null }) | null = {
    ...item(options.initial),
    publishedAt: null,
  };
  const relationWrites = { skills: 0, links: 0, images: 0 };
  let initialReadCount = 0;
  let releaseInitialReads!: () => void;
  const initialReadBarrier = new Promise<void>((resolve) => { releaseInitialReads = resolve; });

  const transaction = {
    $queryRaw: async () => row ? [{ id: row.id, version: row.version }] : [],
    project: {
      findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
        if (!row) return null;
        if (select && Object.keys(select).length === 1 && select.id === true) return { id: row.id };
        const snapshot = {
          version: row.version,
          publishedAt: row.publishedAt,
          links: row.links.map(({ url }) => ({ url })),
          images: row.images.map(({ imageUrl }) => ({ imageUrl })),
        };
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
        if (!row || row.id !== where.id || row.version !== where.version) return [];
        const increment = data.version as { increment: number };
        row = { ...row, ...data, version: row.version + increment.increment } as typeof row;
        return [{ ...row }];
      },
      deleteMany: async ({
        where,
      }: {
        where: { id: string; version: number };
      }) => {
        if (!row || row.id !== where.id || row.version !== where.version) return { count: 0 };
        row = null;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => {
        if (!row) throw new Error("Expected project row.");
        return row;
      },
    },
    projectCategory: { findUnique: async () => ({ id: "category" }) },
    skill: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id })) },
    projectSkill: {
      deleteMany: async () => { relationWrites.skills += 1; },
      createMany: async () => { relationWrites.skills += 1; },
    },
    projectLink: { deleteMany: async () => { relationWrites.links += 1; }, createMany: async () => { relationWrites.links += 1; } },
    projectImage: { deleteMany: async () => { relationWrites.images += 1; }, createMany: async () => { relationWrites.images += 1; } },
  } as never;

  return {
    transaction,
    getRow: () => row,
    relationWrites,
    remove: () => { row = null; },
  };
}

function projectRequest(ifMatch: string | null, body: unknown = {
  title: "Updated project",
  slug: "updated-project",
  summary: "Updated summary",
  description: null,
  categoryId: null,
  featured: false,
  sortOrder: 0,
  status: "DRAFT",
}) {
  const text = JSON.stringify(body);
  const headers = new Headers({ "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)) });
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
  return new Request("https://example.test/api/admin/projects/" + PROJECT_ID, {
    method: "PATCH",
    headers,
    body: text,
  });
}

function projectDeleteRequest(ifMatch: string | null) {
  const headers = new Headers();
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
  return new Request(`https://example.test/api/admin/projects/${PROJECT_ID}`, {
    method: "DELETE",
    headers,
  });
}

test("Project compare-and-swap rejects malformed or missing If-Match and distinguishes missing records", async () => {
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
    const response = await handleProjectUpdate(projectRequest(header), PROJECT_ID, {
      authorize: async () => null,
      update: async () => { writes += 1; return { kind: "missing" }; },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(writes, 0);
  }

  const missing = await handleProjectUpdate(projectRequest('"1"'), PROJECT_ID, {
    authorize: async () => null,
    update: async () => ({ kind: "missing" }),
  });
  assert.equal(missing.status, 404);

  const conflict = await handleProjectUpdate(projectRequest('"1"'), PROJECT_ID, {
    authorize: async () => null,
    update: async () => ({ kind: "conflict" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get("Cache-Control"), "no-store");
  assert.match((await conflict.json() as { error: string }).error, /changed since you opened/u);

  let updateCalled = false;
  const denied = await handleProjectUpdate(projectRequest('"1"'), PROJECT_ID, {
    authorize: async () => new Response(JSON.stringify({ error: "Denied." }), { status: 403 }),
    update: async () => { updateCalled = true; return { kind: "missing" }; },
  });
  assert.equal(denied.status, 403);
  assert.equal(updateCalled, false);
});

test("Project DELETE requires a strong expected version and maps atomic outcomes safely", async () => {
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
  ]) {
    let deletes = 0;
    const response = await handleProjectDelete(projectDeleteRequest(header), PROJECT_ID, {
      authorize: async () => null,
      delete: async () => { deletes += 1; return { kind: "missing" }; },
    });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(deletes, 0);
  }

  let expectedVersion = 0;
  const deleted = await handleProjectDelete(projectDeleteRequest('"2"'), PROJECT_ID, {
    authorize: async () => null,
    delete: async (_id, version) => {
      expectedVersion = version;
      return { kind: "deleted" };
    },
  });
  assert.equal(deleted.status, 200);
  assert.equal(expectedVersion, 2);
  assert.deepEqual(await deleted.json(), { success: true });

  const missing = await handleProjectDelete(projectDeleteRequest('"1"'), PROJECT_ID, {
    authorize: async () => null,
    delete: async () => ({ kind: "missing" }),
  });
  assert.equal(missing.status, 404);

  const conflict = await handleProjectDelete(projectDeleteRequest('"1"'), PROJECT_ID, {
    authorize: async () => null,
    delete: async () => ({ kind: "conflict" }),
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.headers.get("Cache-Control"), "no-store");
  assert.match((await conflict.json() as { error: string }).error, /changed since it was listed/u);

  let deleteCalled = false;
  const denied = await handleProjectDelete(projectDeleteRequest('"1"'), PROJECT_ID, {
    authorize: async () => new Response(JSON.stringify({ error: "Denied." }), { status: 403 }),
    delete: async () => { deleteCalled = true; return { kind: "missing" }; },
  });
  assert.equal(denied.status, 403);
  assert.equal(deleteCalled, false);
});

test("Project atomic DELETE rejects a stale version without removing the updated project", async () => {
  const fake = projectTransaction();
  const updated = await updateProjectInTransaction(
    fake.transaction,
    PROJECT_ID,
    input({ title: "Current project" }),
    1,
    NOW,
  );
  assert.equal(updated.kind, "updated");
  assert.equal(fake.getRow()?.version, 2);

  assert.deepEqual(
    await deleteProjectWithVersion(fake.transaction, PROJECT_ID, 1),
    { kind: "conflict" },
  );
  assert.equal(fake.getRow()?.title, "Current project");
  assert.equal(fake.getRow()?.version, 2);

  assert.deepEqual(
    await deleteProjectWithVersion(fake.transaction, PROJECT_ID, 2),
    { kind: "deleted" },
  );
  assert.equal(fake.getRow(), null);
  assert.deepEqual(
    await deleteProjectWithVersion(fake.transaction, PROJECT_ID, 2),
    { kind: "missing" },
  );
});

test("Project PATCH increments atomically, returns the updated version, and preserves omitted associations", async () => {
  const fake = projectTransaction();
  const result = await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Saved" }), 1, NOW);
  assert.equal(result.kind, "updated");
  if (result.kind !== "updated") return;
  assert.equal(result.project.version, 2);
  assert.equal(result.project.title, "Saved");
  assert.deepEqual(fake.relationWrites, { skills: 0, links: 0, images: 0 });

  let expectedVersion = 0;
  const response = await handleProjectUpdate(projectRequest('"2"'), PROJECT_ID, {
    authorize: async () => null,
    update: async (_id, _data, version) => {
      expectedVersion = version;
      return { kind: "updated", project: { ...result.project, version: 3 } as never };
    },
    now: () => NOW,
  });
  assert.equal(response.status, 200);
  assert.equal(expectedVersion, 2);
  assert.equal(response.headers.get("ETag"), '"3"');
  assert.equal((await response.json() as { project: { version: number } }).project.version, 3);
});

test("Project associations are synchronized only with a successful versioned update", async () => {
  const fake = projectTransaction();
  const result = await updateProjectInTransaction(
    fake.transaction,
    PROJECT_ID,
    input({
      skillIds: [SKILL_ID],
      links: [{ type: "OTHER", label: "Source", url: "https://example.test", sortOrder: 0 }],
      images: [{ imageUrl: "https://example.test/image.png", altText: "Project image", caption: null, sortOrder: 0 }],
    }),
    1,
    NOW,
  );
  assert.equal(result.kind, "updated");
  assert.deepEqual(fake.relationWrites, { skills: 2, links: 2, images: 2 });
  assert.equal(fake.getRow()?.version, 2);
});

test("sequential Project clients cannot overwrite the first saved values or associations", async () => {
  const existingLink = { id: "link-1", type: "OTHER" as const, label: "Source", url: "https://example.test", sortOrder: 0 };
  const existingImage = { id: "image-1", imageUrl: "https://example.test/image.png", altText: "Project", caption: null, sortOrder: 0 };
  const fake = projectTransaction({ initial: { links: [existingLink], images: [existingImage] } });
  const clientA = await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Client A" }), 1, NOW);
  assert.equal(clientA.kind, "updated");

  const clientB = await updateProjectInTransaction(
    fake.transaction,
    PROJECT_ID,
    input({ title: "Stale client B", skillIds: [SKILL_ID], links: [], images: [] }),
    1,
    NOW,
  );
  assert.deepEqual(clientB, { kind: "conflict" });
  assert.equal(fake.getRow()?.title, "Client A");
  assert.equal(fake.getRow()?.version, 2);
  assert.deepEqual(fake.getRow()?.links, [existingLink]);
  assert.deepEqual(fake.getRow()?.images, [existingImage]);
  assert.deepEqual(fake.relationWrites, { skills: 0, links: 0, images: 0 });

  const legitimateFollowup = await updateProjectInTransaction(
    fake.transaction,
    PROJECT_ID,
    input({ title: "Client A follow-up" }),
    2,
    NOW,
  );
  assert.equal(legitimateFollowup.kind, "updated");
  assert.equal(fake.getRow()?.version, 3);
});

test("Project change-and-revert remains stale because the version advances", async () => {
  const fake = projectTransaction();
  await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Temporary title" }), 1, NOW);
  await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Project title" }), 2, NOW);
  assert.equal(fake.getRow()?.title, "Project title");
  assert.equal(fake.getRow()?.version, 3);
  assert.deepEqual(
    await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Stale edit" }), 1, NOW),
    { kind: "conflict" },
  );
  assert.equal(fake.getRow()?.title, "Project title");
});

test("Project publication date follows the established publish and unpublish behavior", async () => {
  const fake = projectTransaction();
  const published = await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ status: "PUBLISHED" }), 1, NOW);
  assert.equal(published.kind, "updated");
  assert.equal(fake.getRow()?.publishedAt?.getTime(), NOW.getTime());
  const draft = await updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ status: "DRAFT" }), 2, new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(draft.kind, "updated");
  assert.equal(fake.getRow()?.publishedAt, null);
});

test("overlapping Project updates allow only one atomic compare-and-swap", async () => {
  const fake = projectTransaction({ barrier: true });
  const [first, second] = await Promise.all([
    updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Concurrent A" }), 1, NOW),
    updateProjectInTransaction(fake.transaction, PROJECT_ID, input({ title: "Concurrent B" }), 1, NOW),
  ]);
  assert.deepEqual([first.kind, second.kind].sort(), ["conflict", "updated"]);
  assert.equal(fake.getRow()?.version, 2);
  assert.ok(["Concurrent A", "Concurrent B"].includes(fake.getRow()?.title ?? ""));
});

test("Project compare-and-swap returns missing if the row disappeared before an update", async () => {
  const fake = projectTransaction();
  fake.remove();
  assert.deepEqual(await updateProjectInTransaction(fake.transaction, PROJECT_ID, input(), 1, NOW), { kind: "missing" });
});

test("Project form sends the loaded If-Match, adopts each returned version, and does not retry conflicts", async () => {
  const calls: Array<{ headers: Headers; body: string }> = [];
  const payload = input({ title: "Unsaved title" });
  let responseVersion = 2;
  const fetcher: typeof fetch = async (_input, init) => {
    calls.push({ headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response(JSON.stringify({ project: item({ version: responseVersion }) }), { status: 200 });
  };

  const first = await saveProjectRecord(item(), payload, fetcher);
  assert.equal(first.ok, true);
  assert.equal(calls[0]?.headers.get("If-Match"), '"1"');
  if (!first.ok) return;
  responseVersion = 3;
  const second = await saveProjectRecord(first.project, payload, fetcher);
  assert.equal(second.ok, true);
  assert.equal(calls[1]?.headers.get("If-Match"), '"2"');

  const conflictCalls: Headers[] = [];
  const conflict = await saveProjectRecord(item(), payload, async (_input, init) => {
    conflictCalls.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ error: "Stale project." }), { status: 409 });
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflictCalls.length, 1);
  assert.equal(JSON.parse(calls[0]!.body).title, "Unsaved title");
  assert.equal(payload.title, "Unsaved title");
});

test("Project creation does not require an If-Match token", async () => {
  let header: string | null = null;
  const result = await saveProjectRecord(null, input(), async (_input, init) => {
    header = new Headers(init?.headers).get("If-Match");
    return new Response(JSON.stringify({ project: item() }), { status: 201 });
  });
  assert.equal(result.ok, true);
  assert.equal(header, null);
});

test("Project delete client sends its loaded version and preserves state for conflicts or uncertain outcomes", async () => {
  const headers: Headers[] = [];
  const deleted = await deleteProjectRecord(PROJECT_ID, 2, async (_input, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json({ success: true });
  });
  assert.deepEqual(deleted, { ok: true });
  assert.equal(headers[0]?.get("If-Match"), '"2"');

  const conflict = await deleteProjectRecord(PROJECT_ID, 2, async () =>
    Response.json({ error: "Project not found." }, { status: 409 }));
  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.outcome, "definite");
    assert.match(conflict.error, /changed since it was listed/u);
  }

  const missing = await deleteProjectRecord(PROJECT_ID, 2, async () =>
    Response.json({ error: "This project changed since it was listed." }, { status: 404 }));
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.outcome, "definite");
    assert.equal(missing.error, "Project not found.");
  }

  const uncertain = await deleteProjectRecord(PROJECT_ID, 2, async () => {
    throw new Error("network interruption");
  });
  assert.equal(uncertain.ok, false);
  if (!uncertain.ok) {
    assert.equal(uncertain.outcome, "unknown");
    assert.match(uncertain.error, /Unable to confirm/u);
  }

  const malformedSuccess = await deleteProjectRecord(PROJECT_ID, 2, async () =>
    Response.json({ deleted: true }));
  assert.equal(malformedSuccess.ok, false);
  if (!malformedSuccess.ok) assert.equal(malformedSuccess.outcome, "unknown");
});

test("deleting an associated Skill increments each affected Project version in the same transaction", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => { calls.push("lock-skill"); return [{ id: SKILL_ID }]; },
    projectSkill: {
      findMany: async () => {
        calls.push("find-project-associations");
        return [{ projectId: PROJECT_ID }, { projectId: PROJECT_ID }];
      },
    },
    project: {
      updateMany: async (args: unknown) => {
        calls.push("increment-project-version");
        assert.deepEqual(args, {
          where: { id: { in: [PROJECT_ID] } },
          data: { version: { increment: 1 } },
        });
      },
    },
    skill: { delete: async () => { calls.push("delete-skill"); } },
  } as never;

  assert.equal(await deleteSkillAndBumpProjectVersions(transaction, SKILL_ID), true);
  assert.deepEqual(calls, ["lock-skill", "find-project-associations", "increment-project-version", "delete-skill"]);
});
