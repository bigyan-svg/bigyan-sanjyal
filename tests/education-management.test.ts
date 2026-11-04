import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteEducationWithVersion,
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
    version: 1,
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
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mockEducationTransaction(current: EducationRecord) {
  let savedRecord = current;
  let savedData: Partial<EducationMutationData> | undefined;
  const transaction = {
    education: {
      findUnique: async ({ select }: { select?: Record<string, boolean> }) =>
        select && Object.keys(select).length === 1 && select.id
          ? { id: savedRecord.id }
          : { ...savedRecord },
      updateManyAndReturn: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const matches = Object.entries(where).every(([field, expected]) => {
          const actual = savedRecord[field as keyof EducationRecord];
          return actual instanceof Date && expected instanceof Date
            ? actual.getTime() === expected.getTime()
            : actual === expected;
        });
        if (!matches) return [];
        savedData = data as Partial<EducationMutationData>;
        const versionUpdate = data.version as { increment?: number } | undefined;
        savedRecord = {
          ...savedRecord,
          ...data,
          version: savedRecord.version + (versionUpdate?.increment ?? 0),
          updatedAt: NOW,
        };
        return [{ ...savedRecord }];
      },
    },
  } as never;
  return { transaction, getSavedData: () => savedData, getSavedRecord: () => savedRecord };
}

function request(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: string,
  contentType = "application/json",
  origin = "https://example.test",
  ifMatch: string | null = method === "PATCH" ? '"1"' : null,
): Request {
  const headers = new Headers({ Origin: origin });
  if (ifMatch !== null) headers.set("If-Match", ifMatch);
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
      update: (id, patch, expectedVersion, now) => updateEducationInTransaction(omittedMock.transaction, id, patch, expectedVersion, now),
    },
  );
  assert.equal(omitted.status, 200);
  assert.deepEqual(omittedMock.getSavedData(), { program: "Updated program", version: { increment: 1 } });
  assert.equal(omittedMock.getSavedRecord().fieldOfStudy, "Example Studies");
  assert.equal(omittedMock.getSavedRecord().description, "Existing description");
  assert.equal(omittedMock.getSavedRecord().startDate?.toISOString(), "2022-01-15T00:00:00.000Z");
  assert.equal(omittedMock.getSavedRecord().endDate?.toISOString(), "2024-06-30T00:00:00.000Z");

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
      update: (id, patch, expectedVersion, now) => updateEducationInTransaction(explicitNullMock.transaction, id, patch, expectedVersion, now),
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
      update: (id, patch, expectedVersion, now) => updateEducationInTransaction(emptyTextMock.transaction, id, patch, expectedVersion, now),
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
      updateManyAndReturn: async () => {
        updateCalls += 1;
        return [];
      },
    },
  } as never;

  const result = await updateEducationInTransaction(
    transaction,
    VALID_ID,
    { endDate: new Date("2024-06-30T00:00:00.000Z") },
    1,
    NOW,
  );
  assert.equal(result.kind, "invalid");
  assert.ok(result.errors?.endDate);
  assert.equal(updateCalls, 0);
});

test("transactional update writes only supplied fields and initializes publication once", async () => {
  let savedData: unknown;
  const current = record({ status: "DRAFT", publishedAt: null });
  const mock = mockEducationTransaction(current);
  const transaction = mock.transaction as { education: { updateManyAndReturn(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<EducationRecord[]> } };
  const updateMany = transaction.education.updateManyAndReturn;
  transaction.education.updateManyAndReturn = async (args) => {
    savedData = args.data;
    return updateMany(args);
  };

  const result = await updateEducationInTransaction(
    mock.transaction,
    VALID_ID,
    { status: "PUBLISHED", program: "Updated program" },
    1,
    NOW,
  );
  assert.equal(result.kind, "updated");
  assert.equal((savedData as Record<string, unknown>).program, "Updated program");
  assert.equal((savedData as Record<string, unknown>).publishedAt, NOW);
  assert.deepEqual((savedData as Record<string, unknown>).version, { increment: 1 });
  assert.equal(mock.getSavedRecord().institution, current.institution);
  assert.equal(mock.getSavedRecord().program, "Updated program");
});

test("concurrent Education PATCHes conflict instead of overwriting a newer update", async () => {
  let current = record();
  let initialReads = 0;
  let releaseReads: (() => void) | undefined;
  const bothRead = new Promise<void>((resolve) => { releaseReads = resolve; });
  const transaction = {
    education: {
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
          const actual = current[field as keyof EducationRecord];
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

  const [programUpdate, descriptionUpdate] = await Promise.all([
    updateEducationInTransaction(transaction, VALID_ID, { program: "Concurrent program" }, 1, NOW),
    updateEducationInTransaction(transaction, VALID_ID, { description: "Concurrent description" }, 1, NOW),
  ]);

  assert.deepEqual([programUpdate.kind, descriptionUpdate.kind].sort(), ["conflict", "updated"]);
  if (programUpdate.kind === "updated") {
    assert.equal(current.program, "Concurrent program");
    assert.equal(current.description, "A plain text description.");
  } else {
    assert.equal(current.program, "Bachelor of Example Studies");
    assert.equal(current.description, "Concurrent description");
  }
});

test("Education PATCH returns a safe no-store conflict response", async () => {
  const response = await handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated" })),
    VALID_ID,
    { authorize: allow, update: async () => ({ kind: "conflict" }) },
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "This record changed since you opened it. Reload the latest version and reconcile your edits before saving again.",
  });
});

test("Education PATCH requires a valid If-Match version and distinguishes missing records", async () => {
  let updateCalls = 0;
  for (const token of [null, "1", '"0"', '"1.5"', 'W/"1"', '"2147483648"']) {
    const response = await handleEducationUpdate(
      request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program: "Updated" }), "application/json", "https://example.test", token),
      VALID_ID,
      { authorize: allow, update: async () => { updateCalls += 1; return { kind: "missing" }; } },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(updateCalls, 0);

  const missing = await handleEducationUpdate(
    request("https://example.test/api/admin/education/22222222-2222-4222-8222-222222222222", "PATCH", JSON.stringify({ program: "Updated" })),
    "22222222-2222-4222-8222-222222222222",
    { authorize: allow, update: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);
});

test("Education version token rejects stale reverted writes and accepts sequential current versions", async () => {
  const mock = mockEducationTransaction(record());
  const patch = (expectedVersion: number, program: string) => handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program }), "application/json", "https://example.test", `"${expectedVersion}"`),
    VALID_ID,
    {
      authorize: allow,
      update: (id, fields, version, now) => updateEducationInTransaction(mock.transaction, id, fields, version, now),
      now: () => NOW,
    },
  );

  const first = await patch(1, "Client A update");
  assert.equal(first.status, 200);
  assert.equal((await first.json()).education.version, 2);
  const stale = await patch(1, "Client B stale update");
  assert.equal(stale.status, 409);
  assert.equal(mock.getSavedRecord().program, "Client A update");
  assert.equal(mock.getSavedRecord().version, 2);

  const next = await patch(2, "Client A reconciled update");
  assert.equal(next.status, 200);
  assert.equal((await next.json()).education.version, 3);

  const revertedMock = mockEducationTransaction(record({ program: "Original" }));
  const revertedPatch = (expectedVersion: number, program: string) => handleEducationUpdate(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "PATCH", JSON.stringify({ program }), "application/json", "https://example.test", `"${expectedVersion}"`),
    VALID_ID,
    {
      authorize: allow,
      update: (id, fields, version, now) => updateEducationInTransaction(revertedMock.transaction, id, fields, version, now),
      now: () => NOW,
    },
  );
  assert.equal((await revertedPatch(1, "Temporary value")).status, 200);
  assert.equal((await revertedPatch(2, "Original")).status, 200);
  assert.equal(revertedMock.getSavedRecord().program, "Original");
  assert.equal(revertedMock.getSavedRecord().version, 3);
  assert.equal((await revertedPatch(1, "Stale value")).status, 409);
  assert.equal(revertedMock.getSavedRecord().program, "Original");
  assert.equal(revertedMock.getSavedRecord().version, 3);
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
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", '"1"'),
    VALID_ID,
    { authorize: async () => Response.json({ error: "Authentication is required." }, { status: 401 }), delete: async () => { deleteCalls += 1; return { kind: "deleted" }; } },
  );
  assert.equal(denied.status, 401);
  assert.equal(deleteCalls, 0);

  const missing = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", '"1"'),
    VALID_ID,
    { authorize: allow, delete: async () => ({ kind: "missing" }) },
  );
  assert.equal(missing.status, 404);
});

test("DELETE validates UUIDs and hides persistence errors", async () => {
  let deleteCalls = 0;
  const invalid = await handleEducationDelete(
    request("https://example.test/api/admin/education/invalid", "DELETE", undefined, "application/json", "https://example.test", '"1"'),
    INVALID_ID,
    { authorize: allow, delete: async () => { deleteCalls += 1; return { kind: "missing" }; } },
  );
  assert.equal(invalid.status, 404);
  assert.equal(deleteCalls, 0);

  const failed = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", '"1"'),
    VALID_ID,
    { authorize: allow, delete: async () => { throw new Error("private database detail"); } },
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await failed.json(), { error: "Unable to delete the Education record." });
});

test("DELETE requires a strong expected version and safely maps atomic outcomes", async () => {
  let deleteCalls = 0;
  for (const token of [null, "1", 'W/"1"', '"0"', '"-1"', '"1.5"', '"not-a-number"', '"2147483648"']) {
    const response = await handleEducationDelete(
      request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", token),
      VALID_ID,
      { authorize: allow, delete: async () => { deleteCalls += 1; return { kind: "missing" }; } },
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(deleteCalls, 0);

  let received: { id: string; version: number } | undefined;
  const deleted = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", '"3"'),
    VALID_ID,
    {
      authorize: allow,
      delete: async (id, version) => {
        received = { id, version };
        return { kind: "deleted" };
      },
    },
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(received, { id: VALID_ID, version: 3 });
  assert.deepEqual(await deleted.json(), { success: true });

  const conflict = await handleEducationDelete(
    request(`https://example.test/api/admin/education/${VALID_ID}`, "DELETE", undefined, "application/json", "https://example.test", '"1"'),
    VALID_ID,
    { authorize: allow, delete: async () => ({ kind: "conflict" }) },
  );
  assert.equal(conflict.status, 409);
  assert.match((await conflict.json() as { error: string }).error, /was not deleted/u);
});

test("Education atomic DELETE compares and deletes only the expected version", async () => {
  let deleteWhere: unknown;
  let currentVersion: number | null = 2;
  let deleteCount = 1;
  const transaction = {
    $queryRaw: async () => currentVersion === null ? [] : [{ id: VALID_ID, version: currentVersion }],
    education: {
      deleteMany: async ({ where }: { where: unknown }) => {
        deleteWhere = where;
        return { count: deleteCount };
      },
    },
  } as never;

  assert.deepEqual(await deleteEducationWithVersion(transaction, VALID_ID, 1), { kind: "conflict" });
  assert.equal(deleteWhere, undefined);
  assert.deepEqual(await deleteEducationWithVersion(transaction, VALID_ID, 2), { kind: "deleted" });
  assert.deepEqual(deleteWhere, { id: VALID_ID, version: 2 });
  currentVersion = null;
  assert.deepEqual(await deleteEducationWithVersion(transaction, VALID_ID, 2), { kind: "missing" });
  currentVersion = 2;
  deleteCount = 0;
  assert.deepEqual(await deleteEducationWithVersion(transaction, VALID_ID, 2), { kind: "conflict" });
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
