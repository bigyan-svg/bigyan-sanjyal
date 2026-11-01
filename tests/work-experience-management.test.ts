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
  type WorkExperienceMutationData,
  type WorkExperienceRecord,
} from "../src/lib/work-experience-validation";
import { updateWorkExperienceInTransaction } from "../src/lib/work-experience-content";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const INVALID_ID = "not-a-uuid";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const FIRST_PUBLISHED_AT = new Date("2024-05-10T08:30:00.000Z");

function validCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    location: "Remote",
    description: "Built and maintained software.",
    startDate: "2022-01-15",
    endDate: "2024-06-30",
    isCurrent: false,
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
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function request(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: string,
  contentType = "application/json",
): Request {
  const headers = new Headers({ Origin: "https://example.test" });
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
    location: "Remote",
    description: "Built software.\nWorked with a team.",
    startDate: new Date("2022-01-15T00:00:00.000Z"),
    endDate: new Date("2024-06-30T00:00:00.000Z"),
    isCurrent: false,
    status: "DRAFT",
    sortOrder: 0,
  });
});

test("requires employer and role title and bounds all text fields", () => {
  const missing = parseCreateWorkExperience(validCreateInput({ employer: " ", roleTitle: "" }));
  assert.equal(missing.errors.employer, "Employer is required.");
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
  assert.ok(parseCreateWorkExperience(validCreateInput({ isCurrent: true })).errors.endDate);
  assert.ok(parseCreateWorkExperience(validCreateInput({ endDate: null })).errors.endDate);

  const current = parseCreateWorkExperience(validCreateInput({
    isCurrent: true,
    endDate: null,
  }));
  assert.ok(current.data);
  assert.equal(current.data.isCurrent, true);
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
  assert.equal(prepared.data?.description, null);
  assert.equal(prepared.data?.sortOrder, 8);

  const invalidTransition = prepareWorkExperienceUpdate(
    record({ isCurrent: false, endDate: new Date("2024-06-30T00:00:00.000Z") }),
    { isCurrent: true },
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
  assert.equal(incompleteExisting.errors.employer, "Employer is required.");
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
  const transaction = {
    workExperience: {
      findUnique: async () => record({ publishedAt: FIRST_PUBLISHED_AT }),
      update: async (args: { data: unknown }) => {
        savedData = args.data;
        return record({
          ...(args.data as WorkExperienceMutationData),
          publishedAt: (args.data as WorkExperienceMutationData).publishedAt,
        });
      },
    },
  } as never;

  const result = await updateWorkExperienceInTransaction(
    transaction,
    VALID_ID,
    { status: "ARCHIVED" },
    NOW,
  );
  assert.equal(result.kind, "updated");
  assert.equal((savedData as WorkExperienceMutationData).employer, "Example Organization");
  assert.equal((savedData as WorkExperienceMutationData).status, "ARCHIVED");
  assert.equal((savedData as WorkExperienceMutationData).publishedAt, FIRST_PUBLISHED_AT);

  let invalidUpdateCalls = 0;
  const invalidTransaction = {
    workExperience: {
      findUnique: async () => record(),
      update: async () => {
        invalidUpdateCalls += 1;
        return record();
      },
    },
  } as never;
  const invalid = await updateWorkExperienceInTransaction(
    invalidTransaction,
    VALID_ID,
    { isCurrent: true },
    NOW,
  );
  assert.equal(invalid.kind, "invalid");
  assert.equal(invalidUpdateCalls, 0);
});

test("deletion validates authorization and IDs and hides persistence errors", async () => {
  let deleteCalls = 0;
  const denied = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE"),
    VALID_ID,
    {
      authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }),
      delete: async () => { deleteCalls += 1; return true; },
    },
  );
  assert.equal(denied.status, 401);
  assert.equal(deleteCalls, 0);

  const invalidId = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${INVALID_ID}`, "DELETE"),
    INVALID_ID,
    { authorize: async () => null, delete: async () => { deleteCalls += 1; return false; } },
  );
  assert.equal(invalidId.status, 404);
  assert.equal(deleteCalls, 0);

  const missing = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE"),
    VALID_ID,
    { authorize: async () => null, delete: async () => false },
  );
  assert.equal(missing.status, 404);

  const failed = await handleWorkExperienceDelete(
    request(`https://example.test/api/admin/experience/${VALID_ID}`, "DELETE"),
    VALID_ID,
    { authorize: async () => null, delete: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to delete work experience." });
});
