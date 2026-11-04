import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  educationSaveEditorTransition,
  type AdminEducationItem,
  type EducationRequestResult,
} from "../src/lib/education-form";

function record(): AdminEducationItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    version: 2,
    institution: "Example Institute",
    program: "Example Program",
    fieldOfStudy: null,
    description: "Test description",
    startDate: null,
    endDate: null,
    isCurrent: false,
    status: "DRAFT",
    publishedAt: null,
    sortOrder: 0,
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-02T12:00:00.000Z",
  };
}

function renderFeedbackMarkup(message: string): string {
  const renderScript = `
    import { createElement } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { EducationSaveFeedback } from "./src/app/admin/education/education-save-feedback.tsx";
    process.stdout.write(renderToStaticMarkup(createElement(EducationSaveFeedback, { message: ${JSON.stringify(message)} })));
  `;
  const rendered = spawnSync(process.execPath, ["--import=tsx", "--input-type=module", "-e", renderScript], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(rendered.status, 0, rendered.stderr);
  return rendered.stdout;
}

test("successful Education create and update transitions both close the editor", () => {
  const editor = { values: { description: "submitted value" } };
  const success: EducationRequestResult<AdminEducationItem> = { ok: true, value: record() };
  const created = educationSaveEditorTransition(editor, success, "create");
  const updated = educationSaveEditorTransition(editor, success, "update");

  assert.equal(created.editor, null);
  assert.equal(created.successMessage, "Education created successfully.");
  assert.equal(updated.editor, null);
  assert.equal(updated.successMessage, "Education updated successfully.");
});

test("failed and conflicting Education updates retain the open editor and never report success", () => {
  const editor = { values: { description: "unsaved value" } };
  const failed: EducationRequestResult<AdminEducationItem> = {
    ok: false,
    error: "Unable to update the Education record.",
  };
  const conflict: EducationRequestResult<AdminEducationItem> = {
    ok: false,
    error: "This record changed since you opened it. Reload the latest version and reconcile your edits before saving again.",
  };

  const failedTransition = educationSaveEditorTransition(editor, failed, "update");
  const conflictTransition = educationSaveEditorTransition(editor, conflict, "update");
  assert.equal(failedTransition.editor, editor);
  assert.equal(failedTransition.editor.values.description, "unsaved value");
  assert.equal(failedTransition.successMessage, "");
  assert.equal(conflictTransition.editor, editor);
  assert.equal(conflictTransition.editor.values.description, "unsaved value");
  assert.equal(conflictTransition.successMessage, "");
});

test("create and update confirmations render as accessible page-level statuses outside dialogs", () => {
  for (const message of [
    "Education created successfully.",
    "Education updated successfully.",
  ]) {
    const markup = renderFeedbackMarkup(message);
    assert.match(markup, new RegExp(message.replaceAll(".", "\\."), "u"));
    assert.match(markup, /role="status" aria-live="polite"/u);
    assert.doesNotMatch(markup, /<dialog/u);
  }
});

test("Education manager ties dialog mounting to editor state and clears feedback on the next edit", async () => {
  const source = await readFile(
    new URL("../src/app/admin/education/education-manager.tsx", import.meta.url),
    "utf8",
  );
  const successBranch = source.indexOf("const result = attempt.value;");
  const failureReturn = source.indexOf("return;", source.indexOf("if (!result.ok)", successBranch));
  const editorTransition = source.indexOf("setEditor(transition.editor)", failureReturn);
  const successSetter = source.indexOf("setPageSuccess(transition.successMessage)", editorTransition);
  const conditionalDialog = source.indexOf("{editor && (", successSetter);
  const editorDialog = source.indexOf("<Dialog", conditionalDialog);
  const dialogEnd = source.indexOf("</Dialog>", editorDialog);
  const openEditor = source.indexOf("function openEditor(");
  const closeEditor = source.indexOf("function closeEditor(", openEditor);

  assert.ok(successBranch >= 0 && failureReturn > successBranch);
  assert.ok(editorTransition > failureReturn && successSetter > editorTransition);
  assert.ok(conditionalDialog > successSetter && editorDialog > conditionalDialog);
  assert.ok(dialogEnd > editorDialog);
  assert.match(source.slice(editorDialog, dialogEnd), /open=\{true\}/u);
  assert.ok(openEditor >= 0 && closeEditor > openEditor);
  assert.match(source.slice(openEditor, closeEditor), /setPageSuccess\(""\)/u);
  assert.match(source, /\{pageSuccess && !editor \?/u);
  assert.doesNotMatch(source, /successFeedbackRef|scrollIntoView/u);

  const failureHandling = source.slice(
    source.indexOf("if (!result.ok)", successBranch),
    failureReturn,
  );
  assert.doesNotMatch(failureHandling, /setEditor\(/u);
});
