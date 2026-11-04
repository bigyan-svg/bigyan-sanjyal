export type BlogOperationKind = "post" | "taxonomy";

export type BlogOperationRunResult<T> =
  | { started: true; value: T }
  | { started: false };

export interface BlogOperationCoordinator {
  isBusy(): boolean;
  run<T>(kind: BlogOperationKind, operation: () => Promise<T>): Promise<BlogOperationRunResult<T>>;
}

export function canDismissBlogEditor(
  isOperationPending: boolean,
  confirmDiscard: () => boolean,
): boolean {
  return !isOperationPending && confirmDiscard();
}

export function createBlogOperationCoordinator(
  onChange: (activeOperation: BlogOperationKind | null) => void = () => undefined,
): BlogOperationCoordinator {
  let activeOperation: BlogOperationKind | null = null;

  return {
    isBusy: () => activeOperation !== null,
    async run<T>(kind: BlogOperationKind, operation: () => Promise<T>) {
      if (activeOperation !== null) return { started: false };

      activeOperation = kind;
      try {
        onChange(kind);
        return { started: true, value: await operation() };
      } finally {
        activeOperation = null;
        onChange(null);
      }
    },
  };
}
