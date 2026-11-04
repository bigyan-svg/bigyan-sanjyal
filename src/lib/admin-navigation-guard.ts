import { confirmDiscardIfDirty } from "./unsaved-changes";

interface AdminFormProtectionState {
  dirty: boolean;
  pending: boolean;
}

const adminFormProtection = new Map<string, AdminFormProtectionState>();

export function setAdminFormProtection(id: string, isDirty: boolean, isPending = false): void {
  if (isDirty || isPending) adminFormProtection.set(id, { dirty: isDirty, pending: isPending });
  else adminFormProtection.delete(id);
}

export function hasProtectedAdminForms(): boolean {
  return [...adminFormProtection.values()].some(({ dirty, pending }) => dirty || pending);
}

export function hasPendingAdminOperations(): boolean {
  return [...adminFormProtection.values()].some(({ pending }) => pending);
}

function hasDirtyAdminForms(): boolean {
  return [...adminFormProtection.values()].some(({ dirty }) => dirty);
}

export function confirmAdminNavigationIfDirty(
  confirmDiscard?: () => boolean,
): boolean {
  if (hasPendingAdminOperations()) return false;
  return confirmDiscardIfDirty(hasDirtyAdminForms(), confirmDiscard);
}

export interface AdminHistoryEntry {
  id: string;
  href: string;
}

export interface AdminHistoryLedger {
  entries: AdminHistoryEntry[];
  index: number;
}

export type AdminHistoryTraversal =
  | { kind: "allow"; index: number }
  | { kind: "restore"; delta: number }
  | { kind: "untracked" };

export function resolveAdminHistoryTraversal(
  ledger: AdminHistoryLedger,
  targetId: string | null,
  isProtected: boolean,
  confirmDiscard: () => boolean,
): AdminHistoryTraversal {
  if (!targetId) return { kind: "untracked" };
  const targetIndex = ledger.entries.findIndex((entry) => entry.id === targetId);
  if (targetIndex < 0) return { kind: "untracked" };
  if (targetIndex === ledger.index) return { kind: "allow", index: targetIndex };
  if (isProtected && !confirmDiscard()) {
    return { kind: "restore", delta: ledger.index - targetIndex };
  }
  return { kind: "allow", index: targetIndex };
}

export function recordAdminHistoryPush(
  ledger: AdminHistoryLedger,
  href: string,
  id: string,
): AdminHistoryLedger {
  const entries = ledger.entries.slice(0, ledger.index + 1);
  entries.push({ href, id });
  return { entries, index: entries.length - 1 };
}
