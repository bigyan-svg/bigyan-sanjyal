import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleWorkExperienceCreate,
  handleWorkExperienceDelete,
  handleWorkExperienceList,
  handleWorkExperienceUpdate,
} from "../src/lib/work-experience-management";
import {
  parseCreateWorkExperience,
  parseUpdateWorkExperience,
  prepareWorkExperienceUpdate,
  resolveWorkExperiencePublishedAt,
  WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH,
  WORK_EXPERIENCE_EMPLOYMENT_TYPE_LABELS,
  type WorkExperienceMutationData,
  type WorkExperienceRecord,
} from "../src/lib/work-experience-validation";
import {
  deleteWorkExperienceWithVersion,
  updateWorkExperienceInTransaction,
} from "../src/lib/work-experience-content";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const INVALID_ID = "not-a-uuid";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const FIRST_PUBLISHED_AT = new Date("2024-05-10T08:30:00.000Z");

function validCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    employmentType: "FULL_TIME",
    location: "Remote",
    description: "Built and maintained software.",
    startDate: "2022-01-15",
    endDate: "2024-06-30",
    currentPosition: false,
    status: "DRAFT",
    sortOrder: 2,
    ...overrides,
  };
}

function record(overrides: Partial<WorkExperienceRecord> = {}): WorkExperienceRecord {
  const parsed = parseCreateWorkExperience(validCreateInput());
  assert.ok(parsed.data);
  return {
    ...parsed.data,
    id: VALID_ID,
    version: 1,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function materialize(data: WorkExperienceMutationData): WorkExperienceRecord {
  return {
    ...data,
    id: VALID_ID,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function request(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: string,
  contentType = "application/json",
  ifMatch: string | null = method === "PATCH" ? '"1"' : null,
): Request {
  const headers = new Headers({ Origin: "https://example.test" });
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
  if (body !== undefined) {
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(Buffer.byteLength(body)));
  }
  return new Request(url, { method, headers, body });
}

test("creates a normalized work experience record with default draft values", () => {
  const input: Record<string, unknown> = validCreateInput({
    employer: "  Example   Organization  ",
    roleTitle: "  Software\nEngineer ",
    location: "  Remote  ",
    description: "  Built software.\r\nWorked with a team.  ",
  });
  delete input.status;
  delete input.sortOrder;
  const parsed = parseCreateWorkExperience(input);

  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.data, {
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    employmentType: "FULL_TIME",
    location: "Remote",
    description: "Built software.\nWorked with a team.",
    startDate: new Date("2022-01-15T00:00:00.000Z"),
    endDate: new Date("2024-06-30T00:00:00.000Z"),
    currentPosition: false,
    status: "DRAFT",
    sortOrder: 0,
  });
});

test("requires a supported employment type on create and rejects unknown or legacy field names", () => {
  for (const employmentType of Object.keys(WORK_EXPERIENCE_EMPLOYMENT_TYPE_LABELS)) {
    const parsed = parseCreateWorkExperience(validCreateInput({ employmentType }));
    assert.equal(parsed.data?.employmentType, employmentType);
    assert.equal(parsed.errors.employmentType, undefined);
  }

  assert.equal(parseCreateWorkExperience(validCreateInput({ employmentType: "VOLUNTEER" })).data, null);
  assert.ok(parseCreateWorkExperience(validCreateInput({ employmentType: null })).errors.employmentType);

  const missingInput: Record<string, unknown> = validCreateInput();
  delete missingInput.employmentType;
  assert.equal(parseCreateWorkExperience(missingInput).errors.employmentType, "Choose an employment type.");
  assert.equal(parseCreateWorkExperience({ ...validCreateInput(), isCurrent: true }).invalidShape, true);
  assert.ok(parseUpdateWorkExperience({ employmentType: "VOLUNTEER" }).errors.employmentType);
  assert.ok(parseCreateWorkExperience(validCreateInput({ currentPosition: "true" })).errors.currentPosition);
  assert.ok(parseUpdateWorkExperience({ currentPosition: "true" }).errors.currentPosition);
});

test("requires a company name and role title and bounds all text fields", () => {
  const missing = parseCreateWorkExperience(validCreateInput({ employer: " ", roleTitle: "" }));
  assert.equal(missing.errors.employer, "Company name is required.");
  assert.equal(missing.errors.roleTitle, "Role title is required.");

  const tooLong = parseCreateWorkExperience(validCreateInput({
    employer: "e".repeat(201),
    roleTitle: "r".repeat(161),
    location: "l".repeat(161),
    description: "d".repeat(WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH + 1),
  }));
  assert.ok(tooLong.errors.employer);
  assert.ok(tooLong.errors.roleTitle);
  assert.ok(tooLong.errors.location);
  assert.ok(tooLong.errors.description);
});

test("accepts valid ISO dates and rejects malformed or impossible calendar dates", () => {
  assert.ok(parseCreateWorkExperience(validCreateInput({ startDate: "2024-02-29" })).data);

  for (const date of ["2023-02-29", "2024-13-01", "2024-2-01", "0000-01-01", "tomorrow"]) {
    assert.ok(parseCreateWorkExperience(validCreateInput({ startDate: date })).errors.startDate);
  }
  assert.ok(parseCreateWorkExperience(validCreateInput({ endDate: "2024-04-31" })).errors.endDate);
});

test("rejects invalid ranges, current roles with end dates, and non-current roles without end dates", () => {
  assert.ok(parseCreateWorkExperience(validCreateInput({
    startDate: "2024-07-01",
    endDate: "2024-06-30",
  })).errors.endDate);
  assert.ok(parseCreateWorkExperience(validCreateInput({ currentPosition: true })).errors.endDate);
  assert.ok(parseCreateWorkExperience(validCreateInput({ endDate: null })).errors.endDate);

  const current = parseCreateWorkExperience(validCreateInput({
    currentPosition: true,
    endDate: null,
  }));
  assert.ok(current.data);
  assert.equal(current.data.currentPosition, true);
  assert.equal(current.data.endDate, null);
});

test("validates ContentStatus, sort order, publishing completeness, and the allowlist", () => {
  assert.ok(parseCreateWorkExperience(validCreateInput({ status: "VISIBLE" })).errors.status);
  assert.ok(parseCreateWorkExperience(validCreateInput({ sortOrder: -1 })).errors.sortOrder);
  assert.ok(parseCreateWorkExperience(validCreateInput({ sortOrder: 1.5 })).errors.sortOrder);
  assert.ok(parseCreateWorkExperience(validCreateInput({ sortOrder: 1_000_000 })).errors.sortOrder);
  assert.ok(parseCreateWorkExperience(validCreateInput({
    status: "PUBLISHED",
    startDate: null,
  })).errors.startDate);
  assert.equal(parseCreateWorkExperience({ ...validCreateInput(), publishedAt: NOW }).invalidShape, true);
  assert.equal(parseCreateWorkExperience({ ...validCreateInput(), unexpected: true }).invalidShape, true);
});

test("PATCH validates supplied fields and preserves omitted values when merged", () => {
  const patch = parseUpdateWorkExperience({ description: null, sortOrder: 8 });
  assert.deepEqual(patch.data, { description: null, sortOrder: 8 });
  assert.equal(parseUpdateWorkExperience({}).invalidShape, true);
  assert.equal(parseUpdateWorkExperience({ employer: "Updated", extra: "no" }).invalidShape, true);

  assert.ok(patch.data);
  const prepared = prepareWorkExperienceUpdate(record(), patch.data, NOW);
  assert.deepEqual(prepared.errors, {});
  assert.equal(prepared.data?.employer, "Example Organization");
  assert.equal(prepared.data?.employmentType, "FULL_TIME");
  assert.equal(prepared.data?.description, null);
  assert.equal(prepared.data?.sortOrder, 8);

  const invalidTransition = prepareWorkExperienceUpdate(
    record({ currentPosition: false, endDate: new Date("2024-06-30T00:00:00.000Z") }),
    { currentPosition: true },
    NOW,
  );
  assert.ok(invalidTransition.errors.endDate);
});

test("initializes first publication and retains publication history across status changes", () => {
  assert.equal(resolveWorkExperiencePublishedAt(null, "DRAFT", NOW), null);
  assert.equal(resolveWorkExperiencePublishedAt(null, "ARCHIVED", NOW), null);
  assert.equal(resolveWorkExperiencePublishedAt(null, "PUBLISHED", NOW), NOW);
  assert.equal(resolveWorkExperiencePublishedAt(FIRST_PUBLISHED_AT, "DRAFT", NOW), FIRST_PUBLISHED_AT);
  assert.equal(resolveWorkExperiencePublishedAt(FIRST_PUBLISHED_AT, "ARCHIVED", NOW), FIRST_PUBLISHED_AT);
  assert.equal(resolveWorkExperiencePublishedAt(FIRST_PUBLISHED_AT, "PUBLISHED", NOW), FIRST_PUBLISHED_AT);

  const publish = prepareWorkExperienceUpdate(
    record({ publishedAt: FIRST_PUBLISHED_AT }),
    { status: "PUBLISHED" },
    NOW,
  );
  assert.equal(publish.data?.publishedAt, FIRST_PUBLISHED_AT);

  const incompleteExisting = prepareWorkExperienceUpdate(
    record({ employer: "" }),
    { status: "PUBLISHED" },
    NOW,
  );
  assert.equal(incompleteExisting.data, null);
  assert.equal(incompleteExisting.errors.employer, "Company name is required.");
});

test("listing authorizes before database reads and returns no-store data", async () => {
  let listCalls = 0;
  const denied = Response.json({ error: "Authentication is required." }, { status: 401 });
  const unauthorized = await handleWorkExperienceList(
    request("https://example.test/api/admin/experience", "GET"),
    {
      authorize: async () => denied,
      findAll: async () => {
        listCalls += 1;
        return [];
      },
    },
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(listCalls, 0);

  const authorized = await handleWorkExperienceList(
    request("https://example.test/api/admin/experience", "GET"),
    { authorize: async () => null, findAll: async () => [record()] },
  );
  assert.equal(authorized.status, 200);
  assert.equal(authorized.headers.get("cache-control"), "no-store");
  assert.equal((await authorized.json()).experiences.length, 1);

  const failed = await handleWorkExperienceList(
    request("https://example.test/api/admin/experience", "GET"),
    {
      authorize: async () => null,
      findAll: async () => { throw new Error("private database detail"); },
    },
  );
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Unable to load work experience." });
});

test("creation authorizes first, validates input, and safely handles persistence failures", async () => {
  let createCalls = 0;
  const denied = await handleWorkExperienceCreate(
    request("https://example.test/api/admin/experience", "POST", JSON.stringify(validCreateInput())),
    {
      authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }),
      create: async () => {
        createCalls += 1;
        return record();
      },
    },
  );
  assert.equal(denied.status, 401);
  assert.equal(createCalls, 0);

  const saved: { data?: WorkExperienceMutationData } = {};
  const success = await handleWorkExperienceCreate(
    request("https://example.test/api/admin/experience", "POST", JSON.stringify(validCreateInput({ status: "PUBLISHED" }))),
    {
      authorize: async () => null,
      now: () => NOW,
      create: async (data) => {
        saved.data = data;
        return materialize(data);
      },
    },
  );
  assert.equal(success.status, 201);
  assert.equal(success.headers.get("cache-control"), "no-store");
  assert.equal(saved.data?.status, "PUBLISHED");
  assert.equal(saved.data?.employmentType, "FULL_TIME");
  assert.equal(saved.data?.currentPosition, false);
  assert.equal(saved.data?.publishedAt, NOW);

  const invalid = await handleWorkExperienceCreate(
    request("https://example.test/api/admin/experience", "POST", JSON.stringify(validCreateInput({ employer: "" }))),
    { authorize: async () => null, create: async () => { createCalls += 1; return record(); } },
  );
  assert.equal(invalid.status, 422);
  assert.equal(createCalls, 0);

  const failed = await handleWorkExperienceCreate(
    request("https://example.test/api/admin/experience", "POST", JSON.stringify(validCreateInput())),
    {
      authorize: async () => null,
      create: async () => { throw new Error("private database detail"); },
    },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to create work experience." });
});

test("bounded JSON parsing rejects malformed and oversized create requests", async () => {
  const dependencies = { authorize: async () => null, create: async () => record() };
  const malformed = await handleWorkExperienceCreate(
    request("https://example.test/api/admin/experience", "POST", "{invalid"),
    dependencies,
  );
  assert.equal(malformed.status, 400);

  const oversized = await handleWorkExperienceCreate(
    request(
      "https://example.test/api/admin/experience",
      "POST",
      JSON.stringify({ ...validCreateInput(), description: "x".repeat(70_000) }),
    ),
    dependencies,
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
});

test("updates reject invalid IDs, preserve authorization, and safely report missing records", async () => {
  let updateCalls = 0;
  const denied = await handleWorkExperienceUpdate(
    request("https://example.test/api/admin/experience/" + VALID_ID, "PATCH", JSON.stringify({ roleTitle: "Updated" })),
    VALID_ID,
    {
      authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }),
      update: async () => {
        updateCalls += 1;
        return { kind: "updated", experience: record() };
      },
    },
  );
  assert.equal(denied.status, 401);
  assert.equal(updateCalls, 0);

  const invalidId = await handleWorkExperienceUpdate(
    request("https://example.test/api/admin/experience/invalid", "PATCH", JSON.stringify({ roleTitle: "Updated" })),
    INVALID_ID,
    { authorize: async () => null, update: async () => { updateCalls += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalidId.status, 404);
  assert.equal(updateCalls, 0);

  const missing = await handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ roleTitle: "Updated" })),
    VALID_ID,
    { authorize: async () => null, update: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Work experience not found." });
});

test("updates return field errors without writing invalid transitions", async () => {
  const invalid = await handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ status: "PUBLISHED" })),
    VALID_ID,
    {
      authorize: async () => null,
      update: async () => ({ kind: "invalid", errors: { startDate: "A start date is required before publishing." } }),
    },
  );
  assert.equal(invalid.status, 422);
  assert.deepEqual((await invalid.json()).fields, {
    startDate: "A start date is required before publishing.",
  });

  const success = await handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ roleTitle: "Updated title" })),
    VALID_ID,
    {
      authorize: async () => null,
      update: async (_id, patch) => ({
        kind: "updated",
        experience: record({ roleTitle: patch.roleTitle ?? "Software Engineer" }),
      }),
    },
  );
  assert.equal(success.status, 200);
  assert.equal((await success.json()).experience.roleTitle, "Updated title");

  const failed = await handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ roleTitle: "Updated title" })),
    VALID_ID,
    {
      authorize: async () => null,
      update: async () => { throw new Error("private database detail"); },
    },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to update work experience." });
});

test("transactional updates preserve omitted fields and publication history", async () => {
  let savedData: unknown;
  let current = record({ publishedAt: FIRST_PUBLISHED_AT });
  const transaction = {
    workExperience: {
      findUnique: async ({ select }: { select: Record<string, boolean> }) =>
        Object.keys(select).length === 1 && select.id ? { id: current.id } : { ...current },
      updateManyAndReturn: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = Object.entries(args.where).every(([field, expected]) => current[field as keyof WorkExperienceRecord] === expected);
        if (!matches) return [];
        savedData = args.data;
        const versionUpdate = args.data.version as { increment?: number } | undefined;
        current = { ...current, ...args.data, version: current.version + (versionUpdate?.increment ?? 0), updatedAt: NOW };
        return [{ ...current }];
      },
    },
  } as never;

  const result = await updateWorkExperienceInTransaction(
    transaction,
    VALID_ID,
    { status: "ARCHIVED" },
    1,
    NOW,
  );
  assert.equal(result.kind, "updated");
  assert.deepEqual(savedData, { status: "ARCHIVED", version: { increment: 1 } });
  assert.equal(current.employer, "Example Organization");
  assert.equal((savedData as Record<string, unknown>).status, "ARCHIVED");
  assert.equal(current.publishedAt, FIRST_PUBLISHED_AT);

  let invalidUpdateCalls = 0;
  const invalidTransaction = {
    workExperience: {
      findUnique: async () => record(),
      updateManyAndReturn: async () => {
        invalidUpdateCalls += 1;
        return [];
      },
    },
  } as never;
  const invalid = await updateWorkExperienceInTransaction(
    invalidTransaction,
    VALID_ID,
    { currentPosition: true },
    1,
    NOW,
  );
  assert.equal(invalid.kind, "invalid");
  assert.equal(invalidUpdateCalls, 0);
});

test("concurrent Work Experience PATCHes conflict instead of overwriting a newer update", async () => {
  let current = record();
  let initialReads = 0;
  let releaseReads: (() => void) | undefined;
  const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
  const transaction = {
    workExperience: {
      findUnique: async ({ select }: { select: Record<string, boolean> }) => {
        const snapshot = { ...current };
        if (initialReads < 2) {
          initialReads += 1;
          if (initialReads === 2) releaseReads?.();
          await bothRead;
          return snapshot;
        }
        return Object.keys(select).length === 1 && select.id
          ? { id: current.id }
          : { ...current };
      },
      updateManyAndReturn: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = Object.entries(where).every(([field, expected]) => {
          const actual = current[field as keyof WorkExperienceRecord];
          return actual instanceof Date && expected instanceof Date
            ? actual.getTime() === expected.getTime()
            : actual === expected;
        });
        if (!matches) return [];
        const versionUpdate = data.version as { increment?: number } | undefined;
        current = { ...current, ...data, version: current.version + (versionUpdate?.increment ?? 0), updatedAt: NOW };
        return [{ ...current }];
      },
    },
  } as never;

  const [employerUpdate, roleUpdate] = await Promise.all([
    updateWorkExperienceInTransaction(transaction, VALID_ID, { employer: "Concurrent employer" }, 1, NOW),
    updateWorkExperienceInTransaction(transaction, VALID_ID, { roleTitle: "Concurrent role" }, 1, NOW),
  ]);

  assert.deepEqual([employerUpdate.kind, roleUpdate.kind].sort(), ["conflict", "updated"]);
  if (employerUpdate.kind === "updated") {
    assert.equal(current.employer, "Concurrent employer");
    assert.equal(current.roleTitle, "Software Engineer");
  } else {
    assert.equal(current.employer, "Example Organization");
    assert.equal(current.roleTitle, "Concurrent role");
  }
});

test("Work Experience PATCH returns a safe no-store conflict response", async () => {
  const response = await handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ employer: "Updated" })),
    VALID_ID,
    { authorize: async () => null, update: async () => ({ kind: "conflict" }) },
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "This record changed since you opened it. Reload the latest version and reconcile your edits before saving again.",
  });
});

test("Work Experience PATCH requires a valid If-Match version and distinguishes missing records", async () => {
  let updateCalls = 0;
  for (const token of [null, "1", '"0"', '"1.5"', 'W/"1"', '"2147483648"']) {
    const response = await handleWorkExperienceUpdate(
      request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ roleTitle: "Updated" }), "application/json", token),
      VALID_ID,
      { authorize: async () => null, update: async () => { updateCalls += 1; return { kind: "missing" }; } },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(updateCalls, 0);

  const missing = await handleWorkExperienceUpdate(
    request("https://example.test/api/admin/experience/22222222-2222-4222-8222-222222222222", "PATCH", JSON.stringify({ roleTitle: "Updated" })),
    "22222222-2222-4222-8222-222222222222",
    { authorize: async () => null, update: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);
});

test("Work Experience version token rejects stale reverted writes and accepts sequential current versions", async () => {
  let current = record();
  const transaction = {
    workExperience: {
      findUnique: async ({ select }: { select: Record<string, boolean> }) =>
        Object.keys(select).length === 1 && select.id ? { id: current.id } : { ...current },
      updateManyAndReturn: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = Object.entries(where).every(([field, expected]) => current[field as keyof WorkExperienceRecord] === expected);
        if (!matches) return [];
        const increment = data.version as { increment?: number } | undefined;
        current = { ...current, ...data, version: current.version + (increment?.increment ?? 0), updatedAt: NOW };
        return [{ ...current }];
      },
    },
  } as never;
  const patch = (expectedVersion: number, roleTitle: string) => handleWorkExperienceUpdate(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "PATCH", JSON.stringify({ roleTitle }), "application/json", `"${expectedVersion}"`),
    VALID_ID,
    {
      authorize: async () => null,
      update: (id, fields, version, now) => updateWorkExperienceInTransaction(transaction, id, fields, version, now),
      now: () => NOW,
    },
  );

  const first = await patch(1, "Client A update");
  assert.equal(first.status, 200);
  assert.equal((await first.json()).experience.version, 2);
  const stale = await patch(1, "Client B stale update");
  assert.equal(stale.status, 409);
  assert.equal(current.roleTitle, "Client A update");
  assert.equal(current.version, 2);
  const next = await patch(2, "Client A reconciled update");
  assert.equal(next.status, 200);
  assert.equal((await next.json()).experience.version, 3);

  current = record({ roleTitle: "Original" });
  assert.equal((await patch(1, "Temporary value")).status, 200);
  assert.equal((await patch(2, "Original")).status, 200);
  assert.equal(current.roleTitle, "Original");
  assert.equal(current.version, 3);
  assert.equal((await patch(1, "Stale value")).status, 409);
  assert.equal(current.roleTitle, "Original");
  assert.equal(current.version, 3);
});

test("deletion validates authorization and IDs and hides persistence errors", async () => {
  let deleteCalls = 0;
  const denied = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", '"1"'),
    VALID_ID,
    {
      authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }),
      delete: async () => { deleteCalls += 1; return { kind: "deleted" }; },
    },
  );
  assert.equal(denied.status, 401);
  assert.equal(deleteCalls, 0);

  const invalidId = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${INVALID_ID}`, "DELETE", undefined, "application/json", '"1"'),
    INVALID_ID,
    { authorize: async () => null, delete: async () => { deleteCalls += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalidId.status, 404);
  assert.equal(deleteCalls, 0);

  const missing = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", '"1"'),
    VALID_ID,
    { authorize: async () => null, delete: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);

  const failed = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", '"1"'),
    VALID_ID,
    { authorize: async () => null, delete: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to delete work experience." });
});

test("DELETE requires a strong expected version and safely maps atomic outcomes", async () => {
  let deleteCalls = 0;
  for (const token of [null, "1", 'W/"1"', '"0"', '"-1"', '"1.5"', '"not-a-number"', '"2147483648"']) {
    const response = await handleWorkExperienceDelete(
      request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", token),
      VALID_ID,
      { authorize: async () => null, delete: async () => { deleteCalls += 1; return { kind: "missing" }; } },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(deleteCalls, 0);

  let received: { id: string; version: number } | undefined;
  const deleted = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", '"3"'),
    VALID_ID,
    {
      authorize: async () => null,
      delete: async (id, version) => {
        received = { id, version };
        return { kind: "deleted" };
      },
    },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(received, { id: VALID_ID, version: 3 });
  assert.deepEqual(await deleted.json(), { success: true });

  const conflict = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE", undefined, "application/json", '"1"'),
    VALID_ID,
    { authorize: async () => null, delete: async () => ({ kind: "conflict" }) },
  );
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json() as { error: string }).error, /was not deleted/u);
});

test("Work Experience atomic DELETE compares and deletes only the expected version", async () => {
  let deleteWhere: unknown;
  let currentVersion: number | null = 2;
  let deleteCount = 1;
  const transaction = {
    $queryRaw: async () => currentVersion === null ? [] : [{ id: VALID_ID, version: currentVersion }],
    workExperience: {
      deleteMany: async ({ where }: { where: unknown }) => {
        deleteWhere = where;
        return { count: deleteCount };
      },
    },
  } as never;

  assert.deepEqual(await deleteWorkExperienceWithVersion(transaction, VALID_ID, 1), { kind: "conflict" });
  assert.equal(deleteWhere, undefined);
  assert.deepEqual(await deleteWorkExperienceWithVersion(transaction, VALID_ID, 2), { kind: "deleted" });
  assert.deepEqual(deleteWhere, { id: VALID_ID, version: 2 });
  currentVersion = null;
  assert.deepEqual(await deleteWorkExperienceWithVersion(transaction, VALID_ID, 2), { kind: "missing" });
  currentVersion = 2;
  deleteCount = 0;
  assert.deepEqual(await deleteWorkExperienceWithVersion(transaction, VALID_ID, 2), { kind: "conflict" });
});
