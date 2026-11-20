import "server-only";

import {
  authorizeAdminContentReadRequest,
  type AdminContentSession,
} from "./admin-content-session";
import {
  getAdminSessionLifetimeRejection,
  isAdminSessionRevoked,
} from "./session-policy";
import { compareSessionPasswordChangeTimestamps } from "./session-password-change";
import {
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "./session-token";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface PreviewDiagnosticSessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    role: string;
    isActive: boolean;
    passwordChangedAt: Date;
  };
  passwordChangeComparison: ReturnType<typeof compareSessionPasswordChangeTimestamps>;
}

export interface PreviewDiagnosticSessionReference {
  id: string;
  userId: string;
}

export interface PreviewDiagnosticSessionReader {
  findByTokenHash(tokenHash: string): Promise<PreviewDiagnosticSessionReference | null>;
  findCurrentByTokenHashAndIdAndUser(
    tokenHash: string,
    sessionId: string,
    userId: string,
  ): Promise<PreviewDiagnosticSessionRecord | null>;
}

export interface PreviewDiagnosticSessionValidationOptions {
  now?: () => number;
  isDevelopment?: boolean;
}

function isValidTimestamp(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isSessionCurrent(
  session: PreviewDiagnosticSessionRecord | null,
  now: number,
): boolean {
  if (
    !session ||
    session.user.id !== session.userId ||
    isAdminSessionRevoked(session.revokedAt) ||
    !isValidTimestamp(session.createdAt) ||
    !isValidTimestamp(session.expiresAt) ||
    !isValidTimestamp(session.lastSeenAt) ||
    !isValidTimestamp(session.user.passwordChangedAt)
  ) {
    return false;
  }

  if (!session.passwordChangeComparison?.isNewer) return false;
  if (!session.user.isActive) return false;

  return getAdminSessionLifetimeRejection(
    session.expiresAt,
    session.lastSeenAt,
    now,
  ) === null;
}

export async function validatePreviewDiagnosticAdminSession(
  token: string,
  reader: PreviewDiagnosticSessionReader,
  options: PreviewDiagnosticSessionValidationOptions = {},
): Promise<AdminContentSession | null> {
  const isDevelopment = options.isDevelopment ?? process.env.NODE_ENV === "development";

  if (
    isDevelopment
      ? !isCurrentDevelopmentSessionToken(token)
      : !SESSION_TOKEN_PATTERN.test(token)
  ) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const sessionReference = await reader.findByTokenHash(tokenHash);
  if (!sessionReference) return null;

  const currentSession = await reader.findCurrentByTokenHashAndIdAndUser(
    tokenHash,
    sessionReference.id,
    sessionReference.userId,
  );
  const now = options.now?.() ?? Date.now();
  if (
    !currentSession ||
    currentSession.id !== sessionReference.id ||
    currentSession.userId !== sessionReference.userId ||
    !isSessionCurrent(currentSession, now)
  ) {
    return null;
  }

  if (currentSession.user.role !== "ADMIN") return null;

  return { user: { role: currentSession.user.role } };
}

export function authorizePreviewDiagnosticAdminRead(
  request: Request,
  reader: PreviewDiagnosticSessionReader,
  options: PreviewDiagnosticSessionValidationOptions = {},
): Promise<Response | null> {
  return authorizeAdminContentReadRequest(
    request,
    (token) => validatePreviewDiagnosticAdminSession(token, reader, options),
  );
}
