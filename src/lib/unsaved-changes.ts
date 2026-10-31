export function hasUnsavedChanges(initialValues: unknown, currentValues: unknown): boolean {
  return JSON.stringify(initialValues) !== JSON.stringify(currentValues);
}

export function confirmDiscardIfDirty(
  isDirty: boolean,
  confirmDiscard: () => boolean = () => window.confirm("Discard your unsaved changes?"),
): boolean {
  return !isDirty || confirmDiscard();
}
