import assert from "node:assert/strict";
import { test } from "node:test";
import {
  educationOrderBy,
  updateEducationInTransaction,
} from "../src/lib/education-content";
import {
  EDUCATION_DESCRIPTION_MAX_LENGTH,
  EDUCATION_ID_PATTERN,
  parseCreateEducation,
  parseUpdateEducation,
  prepareEducationUpdate,
  resolveEducationPublishedAt,
  type EducationMutationData,
  type EducationRecord,
} from "../src/lib/education-validation";
import {
  EDUCATION_REQUEST_MAX_BYTES,
  handleEducationCreate,
  handleEducationDelete,
  handleEducationList,
  handleEducationUpdate,
} from "../src/lib/education-management";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const INVALID_ID = "not-a-uuid";
const NOW = new Date("2026-11-01T12:00:00.000Z");
const FIRST_PUBLISHED_AT = new Date("2024-05-10T08:30:00.000Z");

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    institution: "Example Institute",
    program: "Bachelor of Example Studies",
    fieldOfStudy: "Example Studies",
    description: "A plain text description.",
    startDate: "2022-01-15",
    endDate: "2024-06-30",
    isCurrent: false,
    status: "DRAFT",
    sortOrder: 2,
    ...overrides,
  };
}

function record(overrides: Partial<EducationRecord> = {}): EducationRecord {
  const parsed = parseCreateEducation(validInput());
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

function materialize(data: EducationMutationData): EducationRecord {
  return {
    ...data,
    id: VALID_ID,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mockEducationTransaction(current: EducationRecord) {
  let savedData: EducationMutationData | undefined;
  const transaction = {
    education: {
      findUnique: async () => current,
      update: async ({ data }: { data: EducationMutationData }) => {
        savedData = data;
        return { ...current, ...data, updatedAt: NOW };
      },
    },
  } as never;
  return { transaction, getSavedData: () => savedData };
}

function request(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: string,
  contentType = "application/json",
  origin = "https://example.test",
): Request {
  const headers = new Headers({ Origin: origin });
  if (body !== undefined) {
    headers.set("Content-Type", contentType);
    headers.set("Content-Length", String(Buffer.byteLength(body)));
  }
  return new Request(url, { method, headers, body });
}

const allow = async () => null;

test("Education creation normalizes text, defaults optional fields, and accepts nullable dates", () => {
  const parsed = parseCreateEducation({
    institution: "  Example   Institute  ",
    program: "  Bachelor\n of Studies ",
    fieldOfStudy: "  ",
    description: "  First line.\r\nSecond line.  ",
    startDate: null,
    endDate: null,
  });

  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.data, {
    institution: "Example Institute",
    program: "Bachelor of Studies",
    fieldOfStudy: null,
    description: "First line.\nSecond line.",
    startDate: null,
    endDate: null,
    isCurrent: false,
    status: "DRAFT",
    sortOrder: 0,
  });
});

test("institution and program are required and all text lengths are bounded", () => {
  const missing = parseCreateEducation(validInput({ institution: " ", program: "" }));
  assert.equal(missing.errors.institution, "Institution is required.");
  assert.equal(missing.errors.program, "Program is required.");

  const tooLong = parseCreateEducation(validInput({
    institution: "i".repeat(201),
    program: "p".repeat(201),
    fieldOfStudy: "f".repeat(201),
    description: "d".repeat(EDUCATION_DESCRIPTION_MAX_LENGTH + 1),
  }));
  assert.ok(tooLong.errors.institution);
  assert.ok(tooLong.errors.program);
  assert.ok(tooLong.errors.fieldOfStudy);
  assert.ok(tooLong.errors.description);
});

test("description line breaks are retained and empty optional values normalize to null", () => {
  const parsed = parseCreateEducation(validInput({
    fieldOfStudy: "   ",
    description: "line one\nline two",
  }));
  assert.equal(parsed.data?.fieldOfStudy, null);
  assert.equal(parsed.data?.description, "line one\nline two");
});

test("strict allowlists reject IDs, timestamps, publishedAt, and unknown fields", () => {
  for (const field of ["id", "createdAt", "updatedAt", "publishedAt", "unexpected"]) {
    assert.equal(parseCreateEducation(validInput({ [field]: "value" })).invalidShape, true);
    assert.equal(parseUpdateEducation({ [field]: "value" }).invalidShape, true);
  }
});

test("date validation accepts leap years and rejects impossible or malformed dates", () => {
  assert.equal(parseCreateEducation(validInput({ startDate: "2024-02-29" })).data?.startDate?.toISOString(),
    "2024-02-29T00:00:00.000Z");

  for (const date of ["2023-02-29", "2024-13-01", "2024-2-01", "0000-01-01", "tomorrow"]) {
    assert.ok(parseCreateEducation(validInput({ startDate: date })).errors.startDate);
  }
  assert.ok(parseCreateEducation(validInput({ endDate: "2024-04-31" })).errors.endDate);
  assert.ok(parseCreateEducation(validInput({ startDate: "" })).errors.startDate);
});

test("non-current study may omit either or both dates, and date ranges cannot be reversed", () => {
  assert.deepEqual(parseCreateEducation(validInput({
    startDate: null,
    endDate: null,
    isCurrent: false,
  })).errors, {});
  assert.deepEqual(parseCreateEducation(validInput({
    startDate: "2022-01-01",
    endDate: null,
    isCurrent: false,
  })).errors, {});
  assert.ok(parseCreateEducation(validInput({
    startDate: "2024-07-01",
    endDate: "2024-06-30",
  })).errors.endDate);
});

test("current study cannot have an end date, but dates are not required for publishing", () => {
  assert.ok(parseCreateEducation(validInput({ isCurrent: true, endDate: "2024-06-30" })).errors.endDate);
  const publishedWithoutDates = parseCreateEducation(validInput({
    startDate: null,
    endDate: null,
    isCurrent: true,
    status: "PUBLISHED",
  }));
  assert.deepEqual(publishedWithoutDates.errors, {});
  assert.ok(publishedWithoutDates.data);
});

test("status and sort order accept only supported values and bounded integers", () => {
  for (const status of ["UNKNOWN", "published", 1, null]) {
    assert.ok(parseCreateEducation(validInput({ status })).errors.status);
  }
  for (const sortOrder of [-1, 1.5, 1_000_000, "2", null]) {
    assert.ok(parseCreateEducation(validInput({ sortOrder })).errors.sortOrder);
  }
  assert.ok(parseCreateEducation(validInput({ status: "ARCHIVED", sortOrder: 999_999 })).data);
});

test("PATCH validates supplied fields and leaves final-state validation to the merged record", () => {
  assert.deepEqual(parseUpdateEducation({ program: "Updated program" }), {
    data: { program: "Updated program" },
    errors: {},
  });
  assert.equal(parseUpdateEducation({}).invalidShape, true);
  assert.ok(parseUpdateEducation({ institution: " " }).errors.institution);
  assert.ok(parseUpdateEducation({ isCurrent: "true" }).errors.isCurrent);
  assert.ok(parseUpdateEducation({ endDate: "2024-02-30" }).errors.endDate);
});

test("publication date initializes once and is retained across every later status", () => {
  assert.equal(resolveEducationPublishedAt(null, "DRAFT", NOW), null);
  assert.equal(resolveEducationPublishedAt(null, "ARCHIVED", NOW), null);
  assert.equal(resolveEducationPublishedAt(null, "PUBLISHED", NOW), NOW);

  for (const status of ["DRAFT", "PUBLISHED", "ARCHIVED"] as const) {
    assert.equal(resolveEducationPublishedAt(FIRST_PUBLISHED_AT, status, NOW), FIRST_PUBLISHED_AT);
  }
});

test("update merging preserves omitted fields and publication history", () => {
  const current = record({ status: "PUBLISHED", publishedAt: FIRST_PUBLISHED_AT });
  const updated = prepareEducationUpdate(current, { program: "Updated program" }, NOW);

  assert.deepEqual(updated.errors, {});
  assert.equal(updated.data?.institution, current.institution);
  assert.equal(updated.data?.program, "Updated program");
  assert.equal(updated.data?.fieldOfStudy, current.fieldOfStudy);
  assert.equal(updated.data?.publishedAt, FIRST_PUBLISHED_AT);

  for (const status of ["DRAFT", "ARCHIVED", "PUBLISHED"] as const) {
    const changed = prepareEducationUpdate(current, { status }, NOW);
    assert.equal(changed.data?.publishedAt, FIRST_PUBLISHED_AT);
  }
});

test("PATCH handler preserves omitted optional fields and clears explicitly null fields", async () => {
  const current = record({
    fieldOfStudy: "Example Studies",
    description: "Existing description",
    startDate: new Date("2022-01-15T00:00:00.000Z"),
    endDate: new Date("2024-06-30T00:00:00.000Z"),
  });
  const omittedMock = mockEducationTransaction(current);
  const omitted = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated program" })),
    VALID_ID,
    {
      authorize: allow,
      now: () => NOW,
      update: (id, patch, now) => updateEducationInTransaction(omittedMock.transaction, id, patch, now),
    },
  );
  assert.equal(omitted.status, 200);
  assert.equal(omittedMock.getSavedData()?.fieldOfStudy, "Example Studies");
  assert.equal(omittedMock.getSavedData()?.description, "Existing description");
  assert.equal(omittedMock.getSavedData()?.startDate?.toISOString(), "2022-01-15T00:00:00.000Z");
  assert.equal(omittedMock.getSavedData()?.endDate?.toISOString(), "2024-06-30T00:00:00.000Z");

  const explicitNullMock = mockEducationTransaction(current);
  const cleared = await handleEducationUpdate(
    request(
      `https://example.test/api/admin/education/${VALID_ID}`,
      "PATCH",
      JSON.stringify({ fieldOfStudy: null, description: null, startDate: null, endDate: null }),
    ),
    VALID_ID,
    {
      authorize: allow,
      now: () => NOW,
      update: (id, patch, now) => updateEducationInTransaction(explicitNullMock.transaction, id, patch, now),
    },
  );
  assert.equal(cleared.status, 200);
  assert.equal(explicitNullMock.getSavedData()?.fieldOfStudy, null);
  assert.equal(explicitNullMock.getSavedData()?.description, null);
  assert.equal(explicitNullMock.getSavedData()?.startDate, null);
  assert.equal(explicitNullMock.getSavedData()?.endDate, null);
});

test("PATCH normalizes empty optional text and rejects empty date strings", async () => {
  const current = record();
  const emptyTextMock = mockEducationTransaction(current);
  const emptyText = await handleEducationUpdate(
    request(
      `https://example.test/api/admin/education/${VALID_ID}`,
      "PATCH",
      JSON.stringify({ fieldOfStudy: "  ", description: "" }),
    ),
    VALID_ID,
    {
      authorize: allow,
      update: (id, patch, now) => updateEducationInTransaction(emptyTextMock.transaction, id, patch, now),
    },
  );
  assert.equal(emptyText.status, 200);
  assert.equal(emptyTextMock.getSavedData()?.fieldOfStudy, null);
  assert.equal(emptyTextMock.getSavedData()?.description, null);

  let updateCalls = 0;
  const invalidDate = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ startDate: "" })),
    VALID_ID,
    { authorize: allow, update: async () => { updateCalls += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalidDate.status, 422);
  assert.ok((await invalidDate.json()).fields.startDate);
  assert.equal(updateCalls, 0);
});

test("final merged PATCH state is validated before any database update", async () => {
  const current = record({ isCurrent: true, endDate: null });
  let updateCalls = 0;
  const transaction = {
    education: {
      findUnique: async () => current,
      update: async () => {
        updateCalls += 1;
        return current;
      },
    },
  } as never;

  const result = await updateEducationInTransaction(
    transaction,
    VALID_ID,
    { endDate: new Date("2024-06-30T00:00:00.000Z") },
    NOW,
  );
  assert.equal(result.kind, "invalid");
  assert.ok(result.errors?.endDate);
  assert.equal(updateCalls, 0);
});

test("transactional update writes merged values and preserves a first publication timestamp", async () => {
  let savedData: unknown;
  const current = record({ status: "DRAFT", publishedAt: null });
  const transaction = {
    education: {
      findUnique: async () => current,
      update: async (args: { data: unknown }) => {
        savedData = args.data;
        return materialize(args.data as EducationMutationData);
      },
    },
  } as never;

  const result = await updateEducationInTransaction(
    transaction,
    VALID_ID,
    { status: "PUBLISHED", program: "Updated program" },
    NOW,
  );
  assert.equal(result.kind, "updated");
  assert.equal((savedData as EducationMutationData).program, "Updated program");
  assert.equal((savedData as EducationMutationData).institution, current.institution);
  assert.equal((savedData as EducationMutationData).publishedAt, NOW);
});

test("deterministic list ordering uses sort order, start date with nulls last, then ID", () => {
  assert.deepEqual(educationOrderBy, [
    { sortOrder: "asc" },
    { startDate: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ]);
  assert.match(VALID_ID, EDUCATION_ID_PATTERN);
  assert.doesNotMatch(INVALID_ID, EDUCATION_ID_PATTERN);
});

test("listing authorizes before querying and returns all statuses without caching", async () => {
  let queries = 0;
  const denied = await handleEducationList(request("https://example.test/api/admin/education", "GET"), {
    authorize: async () => Response.json(
      { error: "Authentication is required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    ),
    findAll: async () => { queries += 1; return []; },
  });
  assert.equal(denied.status, 401);
  assert.equal(queries, 0);

  const rows = [record({ status: "DRAFT" }), record({ id: "22222222-2222-4222-8222-222222222222", status: "ARCHIVED" })];
  const response = await handleEducationList(request("https://example.test/api/admin/education", "GET"), {
    authorize: allow,
    findAll: async () => rows,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), JSON.parse(JSON.stringify({ educations: rows })));
});

test("list database failures return a generic no-store error", async () => {
  const response = await handleEducationList(request("https://example.test/api/admin/education", "GET"), {
    authorize: allow,
    findAll: async () => { throw new Error("private database detail"); },
  });
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Unable to load Education records." });
});

test("create requires authorization, parses bounded JSON, and creates a new draft safely", async () => {
  const saved: EducationMutationData[] = [];
  const denied = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", JSON.stringify(validInput())),
    { authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }), create: async (data) => materialize(data) },
  );
  assert.equal(denied.status, 401);
  assert.equal(saved.length, 0);

  const created = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", JSON.stringify(validInput({ status: "DRAFT" }))),
    {
      authorize: allow,
      now: () => NOW,
      create: async (data) => { saved.push(data); return materialize(data); },
    },
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.equal(saved[0]?.publishedAt, null);
  assert.equal((await created.json()).education.status, "DRAFT");
});

test("first publication sets publishedAt even when optional dates are absent", async () => {
  const saved: EducationMutationData[] = [];
  const response = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", JSON.stringify(validInput({
      status: "PUBLISHED",
      startDate: null,
      endDate: null,
      isCurrent: false,
    }))),
    {
      authorize: allow,
      now: () => NOW,
      create: async (data) => { saved.push(data); return materialize(data); },
    },
  );
  assert.equal(response.status, 201);
  assert.equal(saved[0]?.publishedAt, NOW);
});

test("create rejects malformed and oversized JSON before persistence", async () => {
  let creates = 0;
  const dependencies = { authorize: allow, create: async (data: EducationMutationData) => { creates += 1; return materialize(data); } };
  const malformed = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", "{"),
    dependencies,
  );
  assert.equal(malformed.status, 400);

  const largeBody = JSON.stringify({ description: "x".repeat(EDUCATION_REQUEST_MAX_BYTES + 1) });
  const oversized = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", largeBody),
    dependencies,
  );
  assert.equal(oversized.status, 413);
  assert.equal(creates, 0);
});

test("create rejects invalid fields and hides persistence errors", async () => {
  const invalid = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", JSON.stringify(validInput({ program: " " }))),
    { authorize: allow, create: async (data) => materialize(data) },
  );
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).fields.program);

  const failed = await handleEducationCreate(
    request("https://example.test/api/admin/education", "POST", JSON.stringify(validInput())),
    { authorize: allow, create: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to create the Education record." });
});

test("PATCH rejects invalid IDs and returns 404 for a valid missing record", async () => {
  let updateCalls = 0;
  const invalidId = await handleEducationUpdate(
    request("https://example.test/api/admin/education/invalid", "PATCH", JSON.stringify({ program: "Updated" })),
    INVALID_ID,
    { authorize: allow, update: async () => { updateCalls += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalidId.status, 404);
  assert.equal(updateCalls, 0);

  const missing = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated" })),
    VALID_ID,
    { authorize: allow, update: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "Education record not found." });
});

test("PATCH reports final-state validation errors and returns updated records", async () => {
  const invalid = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ endDate: "2024-06-30" })),
    VALID_ID,
    { authorize: allow, update: async () => ({ kind: "invalid", errors: { endDate: "A current study record cannot have an end date." } }) },
  );
  assert.equal(invalid.status, 422);
  assert.ok((await invalid.json()).fields.endDate);

  const updated = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated program" })),
    VALID_ID,
    { authorize: allow, update: async (_id, patch) => ({ kind: "updated", education: record({ program: patch.program ?? "Original program" }) }) },
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.headers.get("cache-control"), "no-store");
  assert.equal((await updated.json()).education.program, "Updated program");
});

test("PATCH rejects unexpected fields and hides database errors", async () => {
  let updates = 0;
  const invalidShape = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ publishedAt: NOW.toISOString() })),
    VALID_ID,
    { authorize: allow, update: async () => { updates += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalidShape.status, 400);
  assert.equal(updates, 0);

  const failed = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated" })),
    VALID_ID,
    { authorize: allow, update: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to update the Education record." });
});

test("DELETE requires authorization and returns not found for a missing record", async () => {
  let deleteCalls = 0;
  const denied = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE"),
    VALID_ID,
    { authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }), delete: async () => { deleteCalls += 1; return true; } },
  );
  assert.equal(denied.status, 401);
  assert.equal(deleteCalls, 0);

  const missing = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE"),
    VALID_ID,
    { authorize: allow, delete: async () => false },
  );
  assert.equal(missing.status, 404);
});

test("DELETE validates UUIDs and hides persistence errors", async () => {
  let deleteCalls = 0;
  const invalid = await handleEducationDelete(
    request("https://example.test/api/admin/education/invalid", "DELETE"),
    INVALID_ID,
    { authorize: allow, delete: async () => { deleteCalls += 1; return false; } },
  );
  assert.equal(invalid.status, 404);
  assert.equal(deleteCalls, 0);

  const failed = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE"),
    VALID_ID,
    { authorize: allow, delete: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to delete the Education record." });
});

test("shared write authorization rejects untrusted Origins and invalid JSON content types", async () => {
  const originalVercel = process.env.VERCEL;
  const originalTrustedOrigin = process.env.AUTH_TRUSTED_ORIGIN;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.VERCEL = "1";
  process.env.AUTH_TRUSTED_ORIGIN = "https://example.test";
  // The authorization module imports the shared Prisma client through session
  // validation. These checks return before session access, so a local placeholder
  // avoids requiring a configured database without opening a connection.
  if (originalDatabaseUrl === undefined) {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  }

  try {
    const { authorizeAdminContentWrite } = await import("../src/lib/auth/admin-content");
    const untrusted = await authorizeAdminContentWrite(
      request("https://example.test/api/admin/education", "POST", "{}", "application/json", "https://attacker.test"),
    );
    assert.equal(untrusted?.status, 403);
    assert.equal(untrusted?.headers.get("cache-control"), "no-store");

    const wrongContentType = await authorizeAdminContentWrite(
      request("https://example.test/api/admin/education", "POST", "{}", "text/plain"),
    );
    assert.equal(wrongContentType?.status, 415);
    assert.equal(wrongContentType?.headers.get("cache-control"), "no-store");
  } finally {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    if (originalTrustedOrigin === undefined) delete process.env.AUTH_TRUSTED_ORIGIN;
    else process.env.AUTH_TRUSTED_ORIGIN = originalTrustedOrigin;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
