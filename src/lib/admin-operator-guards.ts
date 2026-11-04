import type { SafeDatabaseTarget } from "./auth/auth-diagnostics";

export type AdminOperatorAction = "provision-first" | "recover";

export class AdminOperatorGuardError extends Error {}

export function getAdminOperatorConfirmationPhrase(
  action: AdminOperatorAction,
  target: SafeDatabaseTarget,
): string {
  const actionText = action === "provision-first"
    ? "PROVISION FIRST ADMIN"
    : "RECOVER ADMIN ACCESS";

  return `${actionText} ${target.host}:${target.port}/${target.database}`;
}

export function assertProductionAdminOperatorTarget(
  nodeEnvironment: string | undefined,
  target: SafeDatabaseTarget | null,
): asserts target is SafeDatabaseTarget {
  if (nodeEnvironment !== "production") {
    throw new AdminOperatorGuardError("Admin operator commands require NODE_ENV=production.");
  }
  if (!target) {
    throw new AdminOperatorGuardError(
      "DATABASE_URL must identify a PostgreSQL host and database.",
    );
  }
}

export function normalizeAdminOperatorEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}
