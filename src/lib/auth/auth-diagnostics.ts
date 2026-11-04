import "server-only";

export interface SafeDatabaseTarget {
  host: string;
  port: string;
  database: string;
}

export type AuthDiagnosticBoundary =
  | "prisma"
  | "login-api"
  | "admin-api"
  | "session-create"
  | "login-cookie"
  | "session-validator"
  | "proxy"
  | "admin-layout"
  | "admin-dashboard"
  | "logout"
  | "recovery-cli";

export type AuthValidationSource =
  | "admin-layout"
  | "admin-dashboard"
  | "admin-api"
  | "logout"
  | "other";

export type AuthDiagnosticOutcome =
  | "initialized"
  | "accepted"
  | "rejected"
  | "persisted"
  | "issued"
  | "revoked"
  | "cleared"
  | "failed";

export type AuthDiagnosticReason =
  | "missing-cookie"
  | "invalid-development-token"
  | "invalid-token-format"
  | "session-not-found"
  | "session-revoked"
  | "invalid-session-timestamp"
  | "password-change-state-unavailable"
  | "session-not-after-password-change"
  | "inactive-account"
  | "absolute-expiry"
  | "idle-timeout"
  | "activity-revalidation-failed"
  | "invalid-credentials"
  | "rate-limited"
  | "rate-limit-unavailable"
  | "database-error"
  | "role-not-authorized";

export type AuthDiagnosticPhase =
  | "origin-validation"
  | "content-type-validation"
  | "request-validation"
  | "rate-limit"
  | "credential-lookup"
  | "password-verification"
  | "session-persistence"
  | "cookie-issuance"
  | "session-lookup"
  | "session-policy"
  | "password-change-timestamp"
  | "activity-update"
  | "logout-revocation";

export interface AuthDiagnosticDetails {
  boundary: AuthDiagnosticBoundary;
  outcome: AuthDiagnosticOutcome;
  source?: AuthValidationSource;
  reason?: AuthDiagnosticReason;
  phase?: AuthDiagnosticPhase;
  cookieName?: "admin_session";
  cookiePath?: "/";
  httpOnly?: true;
  secure?: boolean;
  sameSite?: "lax";
  browserSession?: true;
  role?: "ADMIN" | "EDITOR";
  databaseTargetSource?:
    | "client-initialization"
    | "existing-client-env-fallback"
    | "uninitialized";
  errorName?: string;
  sessionCreatedAt?: string;
  passwordChangedAt?: string;
  comparisonOperator?: ">";
  timestampsEqual?: boolean;
  comparisonResult?: boolean;
}

export function getSafeDatabaseTarget(
  connectionString: string | undefined,
): SafeDatabaseTarget | null {
  if (!connectionString) return null;

  try {
    const parsed = new URL(connectionString);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return null;
    }

    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!database) return null;

    return {
      host: (parsed.hostname || "unix-socket").slice(0, 200),
      port: (parsed.port || "5432").slice(0, 5),
      database: database.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 100),
    };
  } catch {
    return null;
  }
}

export function logAdminAuthDiagnostic(
  details: AuthDiagnosticDetails,
  databaseTarget: SafeDatabaseTarget | null = getSafeDatabaseTarget(
    process.env.DATABASE_URL,
  ),
): void {
  const serialized = formatAdminAuthDiagnostic(
    details,
    databaseTarget,
    process.env.NODE_ENV,
  );
  if (serialized === null) return;

  console.info("[admin-auth-diagnostic]", serialized);
}

export function formatAdminAuthDiagnostic(
  details: AuthDiagnosticDetails,
  databaseTarget: SafeDatabaseTarget | null,
  nodeEnv: string | undefined,
): string | null {
  if (nodeEnv !== "development") return null;

  return JSON.stringify({
    environment: "development",
    databaseTarget,
    ...details,
  });
}
