import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminRole, ContentStatus } from "../src/generated/prisma/client";
import {
  createEmptyWorkExperienceFormValues,
  deleteWorkExperienceRecord,
  loadWorkExperienceRecords,
  saveWorkExperienceRecord,
  setCurrentEmployment,
  validateWorkExperienceForm,
  workExperienceToFormValues,
  type AdminWorkExperienceItem,
  type WorkExperienceFormValues,
} from "../src/lib/work-experience-form";
import { isAuthorizedWorkExperienceSession } from "../src/lib/work-experience-access";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "../src/lib/unsaved-changes";

const validValues: WorkExperienceFormValues = {
  employer: "Example Organization",
  roleTitle: "Software Engineer",
  location: "Remote",
  description: "Maintained software.",
  startDate: "2022-01-15",
  endDate: "2024-06-30",
  isCurrent: false,
  sortOrder: "2",
  status: "DRAFT",
};

function item(overrides: Partial<AdminWorkExperienceItem> = {}): AdminWorkExperienceItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    location: "Remote",
    description: "Maintained software.",
    startDate: "2022-01-15T00:00:00.000Z",
    endDate: "2024-06-30T00:00:00.000Z",
    isCurrent: false,
    status: "DRAFT",
    publishedAt: null,
    sortOrder: 2,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

function mockFetch(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

test("admin page access requires an authenticated ADMIN or EDITOR session", () => {
  assert.equal(isAuthorizedWorkExperienceSession(null), false);
  assert.equal(isAuthorizedWorkExperienceSession(undefined), false);
  assert.equal(isAuthorizedWorkExperienceSession({ user: { role: "ADMIN" } }), true);
  assert.equal(isAuthorizedWorkExperienceSession({ user: { role: "EDITOR" } }), true);
  assert.equal(
    isAuthorizedWorkExperienceSession({ user: { role: "USER" as AdminRole } }),
    false,
  );
});

test("form values map saved dates and current employment clears the end date", () => {
  const values = workExperienceToFormValues(item());
  assert.equal(values.startDate, "2022-01-15");
  assert.equal(values.endDate, "2024-06-30");

  const current = setCurrentEmployment(values, true);
  assert.equal(current.isCurrent, true);
  assert.equal(current.endDate, "");
  assert.equal(values.endDate, "2024-06-30");
  assert.equal(setCurrentEmployment(current, false).endDate, "");
});

test("form validation requires employment dates and rejects invalid ranges or sort order", () => {
  assert.deepEqual(validateWorkExperienceForm(validValues), {});
  assert.equal(
    validateWorkExperienceForm({ ...validValues, startDate: "" }).startDate,
    "Start date is required.",
  );
  assert.ok(validateWorkExperienceForm({ ...validValues, startDate: "2023-02-29" }).startDate);
  assert.ok(validateWorkExperienceForm({ ...validValues, startDate: "2024-07-01" }).endDate);
  assert.deepEqual(validateWorkExperienceForm({ ...validValues, isCurrent: true }), {});
  assert.ok(validateWorkExperienceForm({ ...validValues, isCurrent: false, endDate: "" }).endDate);
  assert.deepEqual(validateWorkExperienceForm({ ...validValues, isCurrent: true, endDate: "" }), {});
  assert.ok(validateWorkExperienceForm({ ...validValues, sortOrder: "1.5" }).sortOrder);
  assert.ok(validateWorkExperienceForm({ ...validValues, employer: " " }).employer);
});

test("new forms start blank and edited forms preserve all fields", () => {
  assert.deepEqual(createEmptyWorkExperienceFormValues(), {
    employer: "",
    roleTitle: "",
    location: "",
    description: "",
    startDate: "",
    endDate: "",
    isCurrent: false,
    sortOrder: "0",
    status: "DRAFT",
  });

  const saved = item({ status: "ARCHIVED", isCurrent: true, endDate: null, sortOrder: 9 });
  const edited = workExperienceToFormValues(saved);
  assert.equal(edited.employer, saved.employer);
  assert.equal(edited.roleTitle, saved.roleTitle);
  assert.equal(edited.description, saved.description);
  assert.equal(edited.status, "ARCHIVED" satisfies ContentStatus);
  assert.equal(edited.isCurrent, true);
  assert.equal(edited.endDate, "");
  assert.equal(edited.sortOrder, "9");
});

test("create and edit submit to their matching endpoints and preserve submitted values", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetcher = mockFetch(async (input, init) => {
    calls.push({ input, init });
    return Response.json({ experience: item() }, { status: calls.length === 1 ? 201 : 200 });
  });

  const created = await saveWorkExperienceRecord(null, validValues, fetcher);
  const edited = await saveWorkExperienceRecord(item().id, { ...validValues, roleTitle: "Lead Engineer" }, fetcher);

  assert.equal(created.ok, true);
  assert.equal(edited.ok, true);
  assert.equal(String(calls[0]?.input), "/api/admin/experience");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[1]?.init?.method, "PATCH");
  assert.equal(String(calls[1]?.input), `/api/admin/experience/${item().id}`);
  assert.equal(calls[1]?.init?.credentials, "same-origin");
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.equal(
    JSON.parse(String(calls[1]?.init?.body)).roleTitle,
    "Lead Engineer",
  );
});

test("form values stay available after validation and API failures", async () => {
  let apiCalls = 0;
  const invalid = await saveWorkExperienceRecord(null, { ...validValues, endDate: "2022-01-01" }, mockFetch(async () => {
    apiCalls += 1;
    return Response.json({}, { status: 500 });
  }));
  assert.equal(invalid.ok, false);
  assert.ok(!invalid.ok && invalid.fields?.endDate);
  assert.equal(apiCalls, 0);

  const submittedValues = { ...validValues, employer: "Unsaved value" };
  const serverError = await saveWorkExperienceRecord(null, submittedValues, mockFetch(async () => {
    apiCalls += 1;
    return Response.json({ error: "Please correct the highlighted fields.", fields: { employer: "Employer is required." } }, { status: 422 });
  }));
  assert.equal(serverError.ok, false);
  assert.ok(!serverError.ok && serverError.fields?.employer === "Employer is required.");
  assert.equal(apiCalls, 1);
  assert.equal(submittedValues.employer, "Unsaved value");
});

test("API authorization and server failures return safe UI errors", async () => {
  const unauthorized = await loadWorkExperienceRecords(mockFetch(async () =>
    Response.json({ error: "private session details" }, { status: 401 }),
  ));
  assert.equal(unauthorized.ok, false);
  assert.ok(!unauthorized.ok && unauthorized.unauthorized);
  assert.ok(!unauthorized.ok && !unauthorized.error.includes("private"));

  const failure = await loadWorkExperienceRecords(mockFetch(async () =>
    Response.json({ error: "Unable to load work experience." }, { status: 500 }),
  ));
  assert.equal(failure.ok, false);
  assert.ok(!failure.ok && failure.error === "Unable to load work experience.");

  const networkFailure = await loadWorkExperienceRecords(mockFetch(async () => {
    throw new Error("private network exception");
  }));
  assert.equal(networkFailure.ok, false);
  assert.ok(!networkFailure.ok && !networkFailure.error.includes("private network"));
});

test("loading handles an empty state and successful data without caching", async () => {
  let cacheMode: RequestCache | undefined;
  const empty = await loadWorkExperienceRecords(mockFetch(async (_input, init) => {
    cacheMode = init?.cache;
    return Response.json({ experiences: [] });
  }));
  assert.deepEqual(empty, { ok: true, value: [] });
  assert.equal(cacheMode, "no-store");

  const loaded = await loadWorkExperienceRecords(mockFetch(async () =>
    Response.json({ experiences: [item()] }),
  ));
  assert.equal(loaded.ok, true);
  assert.ok(loaded.ok && loaded.value[0]?.employer === "Example Organization");
});

test("delete request is sent only after explicit confirmation", async () => {
  let calls = 0;
  const fetcher = mockFetch(async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "DELETE");
    return Response.json({ message: "Deleted." });
  });

  const cancelled = await deleteWorkExperienceRecord(item().id, false, fetcher);
  assert.equal(cancelled.ok, false);
  assert.equal(calls, 0);

  const confirmed = await deleteWorkExperienceRecord(item().id, true, fetcher);
  assert.equal(confirmed.ok, true);
  assert.equal(calls, 1);
});

test("unsaved work experience form changes prompt before dismissal and remain clean when restored", () => {
  const initial = createEmptyWorkExperienceFormValues();
  const changed = { ...initial, employer: "Unsaved employer" };
  assert.equal(hasUnsavedChanges(initial, changed), true);
  assert.equal(confirmDiscardIfDirty(true, () => false), false);
  assert.equal(confirmDiscardIfDirty(true, () => true), true);
  assert.equal(hasUnsavedChanges(initial, { ...changed, employer: "" }), false);
});
