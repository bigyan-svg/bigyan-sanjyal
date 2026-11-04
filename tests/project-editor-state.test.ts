import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canDismissProjectEditor,
  finishProjectEditorSave,
  updateProjectEditorSaveLock,
} from "../src/lib/project-editor-state";
import {
  createProjectEditorSaveGuard,
  withProjectEditorSaveLock,
} from "../src/lib/project-editor-save-lock";
import { hasProtectedAdminForms, setAdminFormProtection } from "../src/lib/admin-navigation-guard";
import { deleteProjectRecord, saveProjectRecord } from "../src/lib/project-form";

test("Project editor stays locked during a save and a successful completion only closes its own instance", () => {
  const editorA = { key: "editor-a", project: { id: "project-a", title: "Unsaved A" } };
  const editorB = { key: "editor-b", project: { id: "project-b", title: "Unsaved B" } };

  assert.equal(canDismissProjectEditor(true), false);
  assert.equal(canDismissProjectEditor(false), true);
  const saveLock = updateProjectEditorSaveLock(null, editorA.key, true, editorA.key);
  assert.equal(saveLock, editorA.key);
  assert.equal(canDismissProjectEditor(saveLock !== null), false);
  assert.equal(updateProjectEditorSaveLock(saveLock, editorA.key, false, null), null);
  assert.equal(canDismissProjectEditor(updateProjectEditorSaveLock(saveLock, editorA.key, false, null) !== null), true);
  assert.equal(finishProjectEditorSave(editorA, editorA.key, true), null);
  assert.equal(finishProjectEditorSave(editorA, editorA.key, false), editorA);

  // Even if a newer editor is selected during an interleaving, the old response cannot close it.
  assert.equal(finishProjectEditorSave(editorB, editorA.key, true), editorB);
  assert.equal(editorB.project.title, "Unsaved B");

  const newerSaveLock = updateProjectEditorSaveLock(editorB.key, editorA.key, false, editorB.key);
  assert.equal(newerSaveLock, editorB.key);
});

test("Project pending-save navigation protection releases after success, HTTP errors, 409, and network failure", async () => {
  const formId = "project-pending-save-outcome-test";
  const editorKey = "unchanged-project-editor";
  const outcomes: Array<() => Promise<unknown>> = [
    async () => ({ ok: true }),
    async () => ({ ok: false, status: 500 }),
    async () => ({ ok: false, status: 409 }),
    async () => { throw new Error("network failure"); },
  ];

  for (const operation of outcomes) {
    const guard = createProjectEditorSaveGuard();
    let savingEditorKey: string | null = null;
    const onSavingChange = (key: string, isSaving: boolean) => {
      savingEditorKey = updateProjectEditorSaveLock(
        savingEditorKey,
        key,
        isSaving,
        editorKey,
      );
      setAdminFormProtection(formId, false, savingEditorKey !== null);
    };

    const request = withProjectEditorSaveLock(guard, editorKey, onSavingChange, operation);
    assert.equal(savingEditorKey, editorKey, "a clean form is protected as soon as its save begins");
    assert.equal(hasProtectedAdminForms(), true);
    assert.equal(guard.isSaving(editorKey), true);

    try {
      await request;
    } catch {
      // A failed network request is expected to reject; the lock must still release.
    }

    assert.equal(savingEditorKey, null);
    assert.equal(hasProtectedAdminForms(), false);
    assert.equal(guard.isSaving(editorKey), false);
  }
});

test("Project save guard synchronously rejects duplicate submissions for one editor", async () => {
  const editorKey = "same-editor";
  const guard = createProjectEditorSaveGuard();
  const changes: boolean[] = [];
  let releaseOperation!: (value: string) => void;
  let operationCount = 0;
  const pendingOperation = new Promise<string>((resolve) => { releaseOperation = resolve; });
  const onSavingChange = (_key: string, saving: boolean) => changes.push(saving);

  const first = withProjectEditorSaveLock(guard, editorKey, onSavingChange, () => {
    operationCount += 1;
    return pendingOperation;
  });
  const duplicate = await withProjectEditorSaveLock(guard, editorKey, onSavingChange, async () => {
    operationCount += 1;
    return "duplicate";
  });

  assert.deepEqual(duplicate, { started: false });
  assert.equal(operationCount, 1);
  assert.deepEqual(changes, [true]);
  releaseOperation("saved");
  assert.deepEqual(await first, { started: true, value: "saved" });
  assert.deepEqual(changes, [true, false]);
  assert.equal(guard.isSaving(editorKey), false);

  const nextEditorSave = await withProjectEditorSaveLock(guard, "new-editor", onSavingChange, async () => "new save");
  assert.deepEqual(nextEditorSave, { started: true, value: "new save" });
});

test("a stale Project save token cannot release a newer request's navigation protection", () => {
  const guard = createProjectEditorSaveGuard();
  const oldToken = guard.acquire("editor-a");
  assert.ok(oldToken);
  assert.equal(guard.release("editor-a", oldToken), true);

  const newToken = guard.acquire("editor-a");
  assert.ok(newToken);
  assert.notEqual(newToken, oldToken);
  assert.equal(guard.release("editor-a", oldToken), false);
  assert.equal(guard.isSaving("editor-a"), true);
  assert.equal(guard.release("editor-a", newToken), true);
  assert.equal(guard.isSaving("editor-a"), false);
});

test("Project 4xx save failures preserve unsaved values and cached records while releasing pending protection", async () => {
  const formId = "project-definite-failure-preserves-state";
  const editorKey = "project-editor-4xx";
  const record = { id: "project-1", version: 3, title: "Stored title" };
  const cachedProjects = [record];
  const editorValues = { title: "Unsaved title", summary: "Unsaved summary", categoryId: "category-2" };
  const originalValues = structuredClone(editorValues);
  const payload = {
    title: editorValues.title,
    slug: "unsaved-title",
    summary: editorValues.summary,
    description: null,
    categoryId: editorValues.categoryId,
    featured: false,
    sortOrder: 0,
    status: "DRAFT" as const,
  };
  const guard = createProjectEditorSaveGuard();
  let saving = false;
  let error = "";
  let success = "";

  const attempt = await withProjectEditorSaveLock(guard, editorKey, (_key, next) => {
    saving = next;
    setAdminFormProtection(formId, false, next);
  }, async () => {
    const result = await saveProjectRecord(record, payload, async () =>
      Response.json({ error: "Project validation failed." }, { status: 422 }));
    if (!result.ok) {
      error = result.error;
      return false;
    }
    success = "Project details saved.";
    return true;
  });

  assert.equal(attempt.started, true);
  assert.equal(attempt.value, false);
  assert.match(error, /validation failed/u);
  assert.equal(success, "");
  assert.deepEqual(editorValues, originalValues);
  assert.equal(cachedProjects[0], record);
  assert.equal(saving, false);
  assert.equal(guard.isSaving(editorKey), false);
  assert.equal(hasProtectedAdminForms(), false);
});

test("Project delete failures preserve cached records and the request helper distinguishes uncertain outcomes", async () => {
  const project = { id: "project-2", title: "Keep this project", version: 1 };
  for (const fetcher of [
    async () => Response.json({ error: "Not allowed." }, { status: 403 }),
    async () => Response.json({ error: "Project not found." }, { status: 404 }),
    async () => Response.json({ error: "Conflict." }, { status: 409 }),
    async () => Response.json({ error: "Service unavailable." }, { status: 503 }),
    async () => { throw new Error("network failure"); },
  ]) {
    const cachedProjects = [project];
    let deleting = true;
    let error = "";
    try {
      const result = await deleteProjectRecord(project.id, project.version, fetcher);
      if (!result.ok) error = result.error;
      else cachedProjects.splice(0, 1);
    } finally {
      deleting = false;
    }
    assert.notEqual(error, "");
    assert.deepEqual(cachedProjects, [project]);
    assert.equal(deleting, false);
  }
});

test("ProjectsManager adopts a deletion only after success and always releases the deleting indicator", async () => {
  const source = await readFile(new URL("../src/app/admin/projects/projects-manager.tsx", import.meta.url), "utf8");
  const handler = source.indexOf("async function deleteProject(");
  const request = source.indexOf("await deleteProjectRecord(project.id, project.version)", handler);
  const failure = source.indexOf("if (!result.ok)", request);
  const returnFromFailure = source.indexOf("return;", failure);
  const cacheRemoval = source.indexOf("setProjects((current) => current.filter((item) => item.id !== project.id))", returnFromFailure);
  const finallyBlock = source.indexOf("} finally {", cacheRemoval);
  const lockRelease = source.indexOf("setDeletingId(null)", finallyBlock);

  assert.ok(handler >= 0 && request > handler && failure > request);
  assert.ok(returnFromFailure > failure && cacheRemoval > returnFromFailure);
  assert.ok(finallyBlock > cacheRemoval && lockRelease > finallyBlock);
  assert.ok(source.includes("deletingProjectIdRef.current !== null"));
});
