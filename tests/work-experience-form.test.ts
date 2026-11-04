import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { AdminRole, ContentStatus } from "../src/generated/prisma/client";
import {
  createEmptyWorkExperienceFormValues,
  deleteWorkExperienceRecord,
  loadWorkExperienceRecords,
  runWorkExperienceRequestOnce,
  saveWorkExperienceRecord,
  setCurrentEmployment,
  validateWorkExperienceForm,
  workExperienceSaveEditorTransition,
  workExperienceSaveSuccessMessage,
  workExperienceFormPayload,
  workExperienceToFormValues,
  type AdminWorkExperienceItem,
  type WorkExperienceFormValues,
} from "../src/lib/work-experience-form";
import { isAuthorizedWorkExperienceSession } from "../src/lib/work-experience-access";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "../src/lib/unsaved-changes";

const validValues: WorkExperienceFormValues = {
  employer: "Example Organization",
  roleTitle: "Software Engineer",
  employmentType: "FULL_TIME",
  location: "Remote",
  description: "Maintained software.",
  startDate: "2022-01-15",
  endDate: "2024-06-30",
  currentPosition: false,
  sortOrder: "2",
  status: "DRAFT",
};

function item(overrides: Partial<AdminWorkExperienceItem> = {}): AdminWorkExperienceItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    version: 1,
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    employmentType: "FULL_TIME",
    location: "Remote",
    description: "Maintained software.",
    startDate: "2022-01-15T00:00:00.000Z",
    endDate: "2024-06-30T00:00:00.000Z",
    currentPosition: false,
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
  assert.equal(current.currentPosition, true);
  assert.equal(current.endDate, "");
  assert.equal(values.endDate, "2024-06-30");
  assert.equal(setCurrentEmployment(current, false).endDate, "");
  assert.equal(workExperienceFormPayload(current).endDate, null);
  assert.equal(workExperienceFormPayload(current).currentPosition, true);
  assert.equal(
    workExperienceToFormValues(item({ currentPosition: true, endDate: "2024-06-30T00:00:00.000Z" })).endDate,
    "",
  );
});

test("form validation requires employment dates and rejects invalid ranges or sort order", () => {
  assert.deepEqual(validateWorkExperienceForm(validValues), {});
  assert.equal(validateWorkExperienceForm({ ...validValues, employmentType: "" }).employmentType, "Choose an employment type.");
  assert.equal(
    validateWorkExperienceForm({ ...validValues, startDate: "" }).startDate,
    "Start date is required.",
  );
  assert.ok(validateWorkExperienceForm({ ...validValues, startDate: "2023-02-29" }).startDate);
  assert.ok(validateWorkExperienceForm({ ...validValues, startDate: "2024-07-01" }).endDate);
  assert.deepEqual(validateWorkExperienceForm({ ...validValues, currentPosition: true }), {});
  assert.ok(validateWorkExperienceForm({ ...validValues, currentPosition: false, endDate: "" }).endDate);
  assert.deepEqual(validateWorkExperienceForm({ ...validValues, currentPosition: true, endDate: "" }), {});
  assert.ok(validateWorkExperienceForm({ ...validValues, sortOrder: "1.5" }).sortOrder);
  assert.ok(validateWorkExperienceForm({ ...validValues, employer: " " }).employer);
});

test("new forms start blank and edited forms preserve all fields", () => {
  assert.deepEqual(createEmptyWorkExperienceFormValues(), {
    employer: "",
    roleTitle: "",
    employmentType: "",
    location: "",
    description: "",
    startDate: "",
    endDate: "",
    currentPosition: false,
    sortOrder: "0",
    status: "DRAFT",
  });

  const saved = item({ status: "ARCHIVED", currentPosition: true, endDate: null, sortOrder: 9 });
  const edited = workExperienceToFormValues(saved);
  assert.equal(edited.employer, saved.employer);
  assert.equal(edited.roleTitle, saved.roleTitle);
  assert.equal(edited.employmentType, saved.employmentType);
  assert.equal(edited.description, saved.description);
  assert.equal(edited.status, "ARCHIVED" satisfies ContentStatus);
  assert.equal(edited.currentPosition, true);
  assert.equal(edited.endDate, "");
  assert.equal(edited.sortOrder, "9");
});

test("create and edit submit to their matching endpoints and preserve submitted values", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const fetcher = mockFetch(async (input, init) => {
    calls.push({ input, init });
    return Response.json({ experience: item({ version: calls.length }) }, { status: calls.length === 1 ? 201 : 200 });
  });

  const created = await saveWorkExperienceRecord(null, validValues, fetcher);
  const edited = await saveWorkExperienceRecord(item().id, { ...validValues, roleTitle: "Lead Engineer" }, fetcher, item().version);
  const nextEdit = edited.ok
    ? await saveWorkExperienceRecord(item().id, { ...validValues, roleTitle: "Principal Engineer" }, fetcher, edited.value.version)
    : edited;

  assert.equal(created.ok, true);
  assert.equal(edited.ok, true);
  assert.equal(nextEdit.ok, true);
  assert.equal(workExperienceSaveSuccessMessage(created, "create"), "Work experience created successfully.");
  assert.equal(workExperienceSaveSuccessMessage(edited, "update"), "Work experience updated successfully.");
  assert.equal(workExperienceSaveSuccessMessage(nextEdit, "update"), "Work experience updated successfully.");
  const editorState = { values: { ...validValues, roleTitle: "Saved editor" } };
  const createTransition = workExperienceSaveEditorTransition(editorState, created, "create");
  const updateTransition = workExperienceSaveEditorTransition(editorState, edited, "update");
  assert.equal(createTransition.editor, null);
  assert.equal(createTransition.successMessage, "Work experience created successfully.");
  assert.equal(updateTransition.editor, null);
  assert.equal(updateTransition.successMessage, "Work experience updated successfully.");
  assert.equal(String(calls[0]?.input), "/api/admin/experience");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(new Headers(calls[0]?.init?.headers).get("If-Match"), null);
  assert.equal(calls[1]?.init?.method, "PATCH");
  assert.equal(String(calls[1]?.input), `/api/admin/experience/${item().id}`);
  assert.equal(calls[1]?.init?.credentials, "same-origin");
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.equal(new Headers(calls[1]?.init?.headers).get("If-Match"), '"1"');
  assert.equal(new Headers(calls[2]?.init?.headers).get("If-Match"), '"2"');
  assert.equal(edited.ok && edited.value.version, 2);
  assert.equal(nextEdit.ok && nextEdit.value.version, 3);
  assert.equal(
    JSON.parse(String(calls[1]?.init?.body)).roleTitle,
    "Lead Engineer",
  );
  assert.equal(JSON.parse(String(calls[1]?.init?.body)).employmentType, "FULL_TIME");
  assert.equal(JSON.parse(String(calls[1]?.init?.body)).currentPosition, false);
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
    return Response.json({ error: "Please correct the highlighted fields.", fields: { employer: "Company name is required." } }, { status: 422 });
  }));
  assert.equal(serverError.ok, false);
  assert.ok(!serverError.ok && serverError.fields?.employer === "Company name is required.");
  assert.equal(apiCalls, 1);
  assert.equal(submittedValues.employer, "Unsaved value");
});

test("Work Experience client keeps unsaved edits on 409 and never retries with a newer version", async () => {
  const submitted = { ...validValues, roleTitle: "Unsaved concurrent edit" };
  let calls = 0;
  const conflict = await saveWorkExperienceRecord(item().id, submitted, mockFetch(async (_input, init) => {
    calls += 1;
    assert.equal(new Headers(init?.headers).get("If-Match"), '"1"');
    return Response.json({ error: "This record changed since you opened it. Reload the latest version and reconcile your edits before saving again." }, { status: 409 });
  }), item().version);
  assert.equal(conflict.ok, false);
  assert.ok(!conflict.ok && conflict.error.includes("Reload the latest version"));
  assert.equal(workExperienceSaveSuccessMessage(conflict, "update"), "");
  const editorState = { values: submitted };
  const transition = workExperienceSaveEditorTransition(editorState, conflict, "update");
  assert.equal(transition.editor, editorState);
  assert.equal(transition.editor.values.roleTitle, "Unsaved concurrent edit");
  assert.equal(transition.successMessage, "");
  assert.equal(submitted.roleTitle, "Unsaved concurrent edit");
  assert.equal(calls, 1);
});

test("failed Work Experience updates never produce success feedback and preserve edits", async () => {
  const submitted = { ...validValues, roleTitle: "Unconfirmed update" };
  const result = await saveWorkExperienceRecord(item().id, submitted, mockFetch(async () =>
    Response.json({ error: "Unable to update work experience." }, { status: 500 }),
  ), item().version);

  assert.equal(result.ok, false);
  assert.equal(workExperienceSaveSuccessMessage(result, "update"), "");
  const editorState = { values: submitted };
  const transition = workExperienceSaveEditorTransition(editorState, result, "update");
  assert.equal(transition.editor, editorState);
  assert.equal(transition.editor.values.roleTitle, "Unconfirmed update");
  assert.equal(transition.successMessage, "");
});

test("submission lock prevents duplicate Work Experience requests and releases after completion", async () => {
  const lock = { current: false };
  let calls = 0;
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const first = runWorkExperienceRequestOnce(lock, async () => {
    calls += 1;
    await waiting;
    return "saved";
  });
  const second = await runWorkExperienceRequestOnce(lock, async () => {
    calls += 1;
    return "duplicate";
  });

  assert.deepEqual(second, { started: false });
  assert.equal(calls, 1);
  finish();
  assert.deepEqual(await first, { started: true, value: "saved" });
  assert.equal(lock.current, false);
});

test("submission lock releases when a Work Experience save throws", async () => {
  const lock = { current: false };
  await assert.rejects(runWorkExperienceRequestOnce(lock, async () => {
    throw new Error("request failed");
  }));
  assert.equal(lock.current, false);
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

test("delete request sends the loaded version only after confirmation and preserves failures", async () => {
  let calls = 0;
  const fetcher = mockFetch(async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "DELETE");
    assert.equal(new Headers(init?.headers).get("If-Match"), '"2"');
    return Response.json({ success: true });
  });

  const cancelled = await deleteWorkExperienceRecord(item().id, 2, false, fetcher);
  assert.equal(cancelled.ok, false);
  assert.equal(calls, 0);

  const confirmed = await deleteWorkExperienceRecord(item().id, 2, true, fetcher);
  assert.equal(confirmed.ok, true);
  assert.equal(calls, 1);

  const invalidVersion = await deleteWorkExperienceRecord(item().id, 0, true, fetcher);
  assert.equal(invalidVersion.ok, false);
  assert.equal(calls, 1);

  const conflict = await deleteWorkExperienceRecord(
    item().id,
    1,
    true,
    mockFetch(async () => Response.json({
      error: "This work experience record changed since it was loaded. It was not deleted; reload the latest version before trying again.",
    }, { status: 409 })),
  );
  assert.equal(conflict.ok, false);
  assert.ok(!conflict.ok && /was not deleted/u.test(conflict.error));
  assert.ok(!conflict.ok && conflict.outcome === "definite");

  const ambiguous = await deleteWorkExperienceRecord(
    item().id,
    2,
    true,
    mockFetch(async () => { throw new Error("connection lost"); }),
  );
  assert.equal(ambiguous.ok, false);
  assert.ok(!ambiguous.ok && /Unable to confirm whether/u.test(ambiguous.error));
  assert.ok(!ambiguous.ok && ambiguous.outcome === "unknown");

  const malformedSuccess = await deleteWorkExperienceRecord(
    item().id,
    2,
    true,
    mockFetch(async () => Response.json({ unexpected: true })),
  );
  assert.equal(malformedSuccess.ok, false);
  assert.ok(!malformedSuccess.ok && malformedSuccess.outcome === "unknown");
});

test("unsaved work experience form changes prompt before dismissal and remain clean when restored", () => {
  const initial = createEmptyWorkExperienceFormValues();
  const changed = { ...initial, employer: "Unsaved employer" };
  assert.equal(hasUnsavedChanges(initial, changed), true);
  assert.equal(confirmDiscardIfDirty(true, () => false), false);
  assert.equal(confirmDiscardIfDirty(true, () => true), true);
  assert.equal(hasUnsavedChanges(initial, { ...changed, employer: "" }), false);
});

test("Work Experience manager closes only on confirmed saves and keeps page feedback outside the dialog", async () => {
  const source = await readFile(
    new URL("../src/app/admin/experience/experience-manager.tsx", import.meta.url),
    "utf8",
  );
  const resultBranch = source.indexOf("result = request.value;");
  const failureBranch = source.indexOf("if (!result.ok)", resultBranch);
  const failureReturn = source.indexOf("return;", failureBranch);
  const closeTransition = source.indexOf("setEditor(transition.editor)", failureReturn);
  const successMessage = source.indexOf("setPageSuccess(transition.successMessage)", closeTransition);
  const pageFeedback = source.indexOf("{pageSuccess && !editor ?");
  const dialogCondition = source.indexOf("{editor && (", successMessage);
  const dialogStart = source.indexOf("<Dialog", dialogCondition);
  const dialogEnd = source.indexOf("</Dialog>", dialogStart);
  const openEditor = source.indexOf("function openEditor(");
  const closeEditor = source.indexOf("function closeEditor(", openEditor);

  assert.ok(resultBranch >= 0 && failureBranch > resultBranch);
  assert.ok(failureReturn > failureBranch && closeTransition > failureReturn);
  assert.ok(successMessage > closeTransition);
  assert.ok(pageFeedback >= 0 && pageFeedback < dialogCondition);
  assert.ok(dialogCondition > successMessage && dialogStart > dialogCondition);
  assert.ok(dialogEnd > dialogStart);
  assert.match(source.slice(dialogStart, dialogEnd), /open=\{true\}/u);
  assert.doesNotMatch(source.slice(dialogStart, dialogEnd), /pageSuccess|experience-management__feedback--success/u);
  assert.match(source, /role="status" aria-live="polite"/u);
  assert.ok(openEditor >= 0 && closeEditor > openEditor);
  assert.match(source.slice(openEditor, closeEditor), /setPageSuccess\(""\)/u);
  assert.match(source, /id="experience-employment-type"/u);
  assert.match(source, /Employment type/u);
  assert.match(source, /label="Company name"/u);
  assert.match(source, /I currently work here/u);
  assert.match(source, /disabled=\{editor\.values\.currentPosition\}/u);
  assert.match(source, /finally\s*\{\s*setSaving\(false\);\s*\}/u);
  assert.match(source, /submittedEditor\.item\?\.version/u);

  const failureHandling = source.slice(failureBranch, failureReturn);
  assert.match(failureHandling, /setPageError\(result\.error\)/u);
  assert.doesNotMatch(failureHandling, /setEditor\(/u);
});

test("Work Experience manager retains the pending record and list when DELETE fails", async () => {
  const source = await readFile(
    new URL("../src/app/admin/experience/experience-manager.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function confirmDelete()");
  const confirmDelete = source.slice(start, source.indexOf("return (", start));
  const failureBranch = confirmDelete.indexOf("if (!result.ok)");
  const failureReturn = confirmDelete.indexOf("return;", failureBranch);
  const clearPending = confirmDelete.indexOf("setPendingDelete(null)");

  assert.match(confirmDelete, /deleteWorkExperienceRecord\(pendingDelete\.id, pendingDelete\.version, true\)/u);
  assert.ok(failureBranch >= 0 && failureReturn > failureBranch);
  assert.ok(clearPending > failureReturn);
  assert.doesNotMatch(confirmDelete.slice(failureBranch, failureReturn), /setItems\(|setPendingDelete\(null\)|refreshRecords\(/u);
});
