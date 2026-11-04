export type ProjectEditorSaveToken = symbol;

export interface ProjectEditorSaveGuard {
  acquire(editorKey: string): ProjectEditorSaveToken | null;
  isSaving(editorKey: string): boolean;
  release(editorKey: string, token: ProjectEditorSaveToken): boolean;
}

export type ProjectEditorSaveAttempt<T> =
  | { started: true; value: T }
  | { started: false };

/** A synchronous, per-editor guard against duplicate submissions. */
export function createProjectEditorSaveGuard(): ProjectEditorSaveGuard {
  const activeTokens = new Map<string, ProjectEditorSaveToken>();

  return {
    acquire(editorKey) {
      if (activeTokens.has(editorKey)) return null;
      const token = Symbol(editorKey);
      activeTokens.set(editorKey, token);
      return token;
    },
    isSaving(editorKey) {
      return activeTokens.has(editorKey);
    },
    release(editorKey, token) {
      if (activeTokens.get(editorKey) !== token) return false;
      activeTokens.delete(editorKey);
      return true;
    },
  };
}

export async function withProjectEditorSaveLock<T>(
  guard: ProjectEditorSaveGuard,
  editorKey: string,
  onSavingChange: (editorKey: string, isSaving: boolean) => void,
  operation: () => Promise<T>,
): Promise<ProjectEditorSaveAttempt<T>> {
  const token = guard.acquire(editorKey);
  if (!token) return { started: false };

  try {
    onSavingChange(editorKey, true);
    return { started: true, value: await operation() };
  } finally {
    if (guard.release(editorKey, token)) onSavingChange(editorKey, false);
  }
}
