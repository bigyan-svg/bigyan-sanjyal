export interface ProjectEditorSession<T> {
  key: string;
  project: T;
}

export function canDismissProjectEditor(isSaving: boolean): boolean {
  return !isSaving;
}

export function updateProjectEditorSaveLock(
  currentSavingEditorKey: string | null,
  editorKey: string,
  isSaving: boolean,
  activeEditorKey: string | null,
): string | null {
  if (isSaving) return activeEditorKey === editorKey ? editorKey : currentSavingEditorKey;
  return currentSavingEditorKey === editorKey ? null : currentSavingEditorKey;
}

export function finishProjectEditorSave<T>(
  current: ProjectEditorSession<T> | null,
  savingEditorKey: string,
  succeeded: boolean,
): ProjectEditorSession<T> | null {
  return succeeded && current?.key === savingEditorKey ? null : current;
}
