import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AdminRole } from "../src/generated/prisma/client";
import {
  createEmptyEducationFormValues,
  deleteEducationRecord,
  educationSaveSuccessMessage,
  educationFormPayload,
  educationToFormValues,
  loadEducationRecords,
  runEducationRequestOnce,
  saveEducationRecord,
  setCurrentEducation,
  validateEducationForm,
  type AdminEducationItem,
  type EducationFormValues,
} from "../src/lib/education-form";
import { isAuthorizedEducationSession } from "../src/lib/education-access";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "../src/lib/unsaved-changes";

const validValues: EducationFormValues = {
  institution: "Example Institute",
  program: "Bachelor of Example Studies",
  fieldOfStudy: "Example Studies",
  description: "Completed a course of study.",
  startDate: "2022-01-15",
  endDate: "2024-06-30",
  isCurrent: false,
  sortOrder: "2",
  status: "DRAFT",
};

function item(overrides: Partial<AdminEducationItem> = {}): AdminEducationItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    institution: "Example Institute",
    program: "Bachelor of Example Studies",
    fieldOfStudy: "Example Studies",
    description: "Completed a course of study.",
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

test("admin page access permits only authenticated ADMIN and EDITOR sessions", () => {
  assert.equal(isAuthorizedEducationSession(null), false);
  assert.equal(isAuthorizedEducationSession(undefined), false);
  assert.equal(isAuthorizedEducationSession({ user: { role: "ADMIN" } }), true);
  assert.equal(isAuthorizedEducationSession({ user: { role: "EDITOR" } }), true);
  assert.equal(
    isAuthorizedEducationSession({ user: { role: "USER" as AdminRole } }),
    false,
  );
});

test("new forms are blank and editing maps every saved field", () => {
  assert.deepEqual(createEmptyEducationFormValues(), {
    institution: "",
    program: "",
    fieldOfStudy: "",
    description: "",
    startDate: "",
    endDate: "",
    isCurrent: false,
    sortOrder: "0",
    status: "DRAFT",
  });

  const saved = item({
    status: "ARCHIVED",
    isCurrent: true,
    endDate: null,
    fieldOfStudy: null,
    description: null,
    startDate: null,
    sortOrder: 9,
  });
  const edited = educationToFormValues(saved);
  assert.equal(edited.institution, saved.institution);
  assert.equal(edited.program, saved.program);
  assert.equal(edited.fieldOfStudy, "");
  assert.equal(edited.description, "");
  assert.equal(edited.startDate, "");
  assert.equal(edited.endDate, "");
  assert.equal(edited.isCurrent, true);
  assert.equal(edited.status, "ARCHIVED");
  assert.equal(edited.sortOrder, "9");
});

test("required fields, optional dates, lengths, and date ranges validate like the API", () => {
  assert.deepEqual(validateEducationForm(validValues), {});
  assert.deepEqual(validateEducationForm({
    ...validValues,
    institution: " ",
    program: "",
    startDate: "",
    endDate: "",
  }).institution, "Institution is required.");
  assert.equal(
    validateEducationForm({ ...validValues, program: "" }).program,
    "Program is required.",
  );
  assert.deepEqual(validateEducationForm({
    ...validValues,
    fieldOfStudy: "",
    description: "",
    startDate: "",
    endDate: "",
  }), {});
  assert.ok(validateEducationForm({ ...validValues, institution: "i".repeat(201) }).institution);
  assert.ok(validateEducationForm({ ...validValues, program: "p".repeat(201) }).program);
  assert.ok(validateEducationForm({ ...validValues, fieldOfStudy: "f".repeat(201) }).fieldOfStudy);
  assert.ok(validateEducationForm({ ...validValues, description: "d".repeat(10_001) }).description);
  assert.ok(validateEducationForm({ ...validValues, startDate: "2023-02-29" }).startDate);
  assert.ok(validateEducationForm({ ...validValues, startDate: "2024-07-01" }).endDate);
  assert.ok(validateEducationForm({ ...validValues, sortOrder: "1.5" }).sortOrder);
});

test("current education clears and disables its end date without changing the original values", () => {
  const current = setCurrentEducation(validValues, true);
  assert.equal(current.isCurrent, true);
  assert.equal(current.endDate, "");
  assert.equal(validValues.endDate, "2024-06-30");
  assert.deepEqual(validateEducationForm(current), {});
  assert.equal(setCurrentEducation(current, false).endDate, "");
});

test("payload normalizes blank optional text and dates to nullable API fields", () => {
  assert.deepEqual(educationFormPayload({
    ...validValues,
    fieldOfStudy: "  ",
    description: "",
    startDate: "",
    endDate: "",
  }), {
    institution: "Example Institute",
    program: "Bachelor of Example Studies",
    fieldOfStudy: null,
    description: null,
    startDate: null,
    endDate: null,
    isCurrent: false,
    sortOrder: 2,
    status: "DRAFT",
  });
});

test("create and edit use the Education API with matching payloads", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetcher = mockFetch(async (input, init) => {
    calls.push({ input, init });
    return Response.json({ education: item({ version: calls.length }) }, { status: calls.length === 1 ? 201 : 200 });
  });

  const created = await saveEducationRecord(null, validValues, fetcher);
  const edited = await saveEducationRecord(item().id, { ...validValues, program: "Updated program" }, fetcher, item().version);
  const nextEdit = edited.ok
    ? await saveEducationRecord(item().id, { ...validValues, program: "Another update" }, fetcher, edited.value.version)
    : edited;

  assert.equal(created.ok, true);
  assert.equal(edited.ok, true);
  assert.equal(nextEdit.ok, true);
  assert.equal(educationSaveSuccessMessage(created, "create"), "Education created successfully.");
  assert.equal(educationSaveSuccessMessage(edited, "update"), "Education updated successfully.");
  assert.equal(educationSaveSuccessMessage(nextEdit, "update"), "Education updated successfully.");
  assert.equal(String(calls[0]?.input), "/api/admin/education");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(new Headers(calls[0]?.init?.headers).get("If-Match"), null);
  assert.equal(calls[1]?.init?.method, "PATCH");
  assert.equal(String(calls[1]?.input), `/api/admin/education/${item().id}`);
  assert.equal(calls[1]?.init?.credentials, "same-origin");
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.equal(new Headers(calls[1]?.init?.headers).get("Content-Type"), "application/json");
  assert.equal(new Headers(calls[1]?.init?.headers).get("If-Match"), '"1"');
  assert.equal(new Headers(calls[2]?.init?.headers).get("If-Match"), '"2"');
  assert.equal(edited.ok && edited.value.version, 2);
  assert.equal(nextEdit.ok && nextEdit.value.version, 3);
  assert.equal(JSON.parse(String(calls[1]?.init?.body)).program, "Updated program");
});

test("validation and server failures retain the submitted form values", async () => {
  let apiCalls = 0;
  const invalidValues = { ...validValues, startDate: "2024-07-01" };
  const invalid = await saveEducationRecord(null, invalidValues, mockFetch(async () => {
    apiCalls += 1;
    return Response.json({}, { status: 500 });
  }));
  assert.equal(invalid.ok, false);
  assert.ok(!invalid.ok && invalid.fields?.endDate);
  assert.equal(apiCalls, 0);
  assert.deepEqual(invalidValues, { ...validValues, startDate: "2024-07-01" });

  const submittedValues = { ...validValues, institution: "Unsaved institution" };
  const serverError = await saveEducationRecord(null, submittedValues, mockFetch(async () => {
    apiCalls += 1;
    return Response.json({ error: "Please correct the highlighted fields.", fields: { program: "Program is required." } }, { status: 422 });
  }));
  assert.equal(serverError.ok, false);
  assert.ok(!serverError.ok && serverError.fields?.program);
  assert.equal(submittedValues.institution, "Unsaved institution");
  assert.equal(apiCalls, 1);
});

test("Education client keeps unsaved edits on 409 and never retries with a newer version", async () => {
  const submitted = { ...validValues, program: "Unsaved concurrent edit" };
  let calls = 0;
  const conflict = await saveEducationRecord(item().id, submitted, mockFetch(async (_input, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get("If-Match"), '"1"');
    return Response.json({ error: "This record changed since you opened it. Reload the latest version and reconcile your edits before saving again." }, { status: 409 });
  }), item().version);
  assert.equal(conflict.ok, false);
  assert.ok(!conflict.ok && conflict.error.includes("Reload the latest version"));
  assert.equal(educationSaveSuccessMessage(conflict, "update"), "");
  assert.equal(submitted.program, "Unsaved concurrent edit");
  assert.equal(calls, 1);
});

test("failed Education updates never produce a success announcement", async () => {
  const result = await saveEducationRecord(item().id, { ...validValues, program: "Unconfirmed update" }, mockFetch(async () =>
    Response.json({ error: "Unable to update the Education record." }, { status: 500 }),
  ), item().version);

  assert.equal(result.ok, false);
  assert.equal(educationSaveSuccessMessage(result, "update"), "");
});

test("expired sessions and malformed list responses produce safe UI errors", async () => {
  const unauthorized = await loadEducationRecords(mockFetch(async () =>
    Response.json({ error: "Authentication is required." }, { status: 401 }),
  ));
  assert.equal(unauthorized.ok, false);
  assert.ok(!unauthorized.ok && unauthorized.unauthorized);

  const malformed = await loadEducationRecords(mockFetch(async () => Response.json({ records: [] })));
  assert.equal(malformed.ok, false);
});

test("delete sends the loaded version only after confirmation and preserves stale-delete errors", async () => {
  let calls = 0;
  const fetcher = mockFetch(async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "DELETE");
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("If-Match"), '"2"');
    return Response.json({ success: true });
  });

  const cancelled = await deleteEducationRecord(item().id, 2, false, fetcher);
  assert.equal(cancelled.ok, false);
  assert.ok(!cancelled.ok && cancelled.cancelled);
  assert.equal(calls, 0);

  const confirmed = await deleteEducationRecord(item().id, 2, true, fetcher);
  assert.equal(confirmed.ok, true);
  assert.equal(calls, 1);

  const invalidVersion = await deleteEducationRecord(item().id, 0, true, fetcher);
  assert.equal(invalidVersion.ok, false);
  assert.equal(calls, 1);

  const conflict = await deleteEducationRecord(
    item().id,
    1,
    true,
    mockFetch(async () => Response.json({
      error: "This Education record changed since it was loaded. It was not deleted; reload the latest version before trying again.",
    }, { status: 409 })),
  );
  assert.equal(conflict.ok, false);
  assert.ok(!conflict.ok && /was not deleted/u.test(conflict.error));
  assert.ok(!conflict.ok && conflict.outcome === "definite");

  const ambiguous = await deleteEducationRecord(
    item().id,
    2,
    true,
    mockFetch(async () => { throw new Error("connection lost"); }),
  );
  assert.equal(ambiguous.ok, false);
  assert.ok(!ambiguous.ok && /Unable to confirm whether/u.test(ambiguous.error));
  assert.ok(!ambiguous.ok && ambiguous.outcome === "unknown");

  const malformedSuccess = await deleteEducationRecord(
    item().id,
    2,
    true,
    mockFetch(async () => Response.json({ unexpected: true })),
  );
  assert.equal(malformedSuccess.ok, false);
  assert.ok(!malformedSuccess.ok && malformedSuccess.outcome === "unknown");
});

test("Education manager retains the pending record and list when DELETE fails", async () => {
  const source = await readFile(
    new URL("../src/app/admin/education/education-manager.tsx", import.meta.url),
    "utf8",
  );
  const confirmDelete = source.slice(source.indexOf("async function confirmDelete()"), source.indexOf("return (", source.indexOf("async function confirmDelete()")));
  const failureBranch = confirmDelete.indexOf("if (!result.ok)");
  const failureReturn = confirmDelete.indexOf("return;", failureBranch);
  const clearPending = confirmDelete.indexOf("setPendingDelete(null)");

  assert.match(confirmDelete, /deleteEducationRecord\(pendingDelete\.id, pendingDelete\.version, true\)/u);
  assert.ok(failureBranch >= 0 && failureReturn > failureBranch);
  assert.ok(clearPending > failureReturn);
  assert.doesNotMatch(confirmDelete.slice(failureBranch, failureReturn), /setItems\(|setPendingDelete\(null\)|refreshRecords\(/u);
});

test("submission lock prevents duplicate requests and releases after completion", async () => {
  const lock = { current: false };
  let calls = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const first = runEducationRequestOnce(lock, async () => {
    calls += 1;
    await waiting;
    return "saved";
  });
  const second = await runEducationRequestOnce(lock, async () => {
    calls += 1;
    return "duplicate";
  });

  assert.deepEqual(second, { started: false });
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, { started: true, value: "saved" });
  assert.equal(lock.current, false);
});

test("submission lock releases when a save operation fails", async () => {
  const lock = { current: false };
  await assert.rejects(runEducationRequestOnce(lock, async () => {
    throw new Error("request failed");
  }));
  assert.equal(lock.current, false);
});

test("unsaved education edits use the shared discard confirmation behavior", () => {
  const initial = createEmptyEducationFormValues();
  const edited = { ...initial, institution: "Unsaved institution" };
  assert.equal(hasUnsavedChanges(initial, edited), true);
  assert.equal(confirmDiscardIfDirty(true, () => false), false);
  assert.equal(confirmDiscardIfDirty(true, () => true), true);
  assert.equal(confirmDiscardIfDirty(false, () => false), true);
});
