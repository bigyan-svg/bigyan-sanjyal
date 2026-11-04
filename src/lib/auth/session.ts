import "server-only";

import type { AdminRole } from "@/generated/prisma/client";
import { getPrismaDatabaseIdentity, prisma } from "@/lib/prisma";
import {
  logAdminAuthDiagnostic,
  type AuthDiagnosticReason,
  type AuthValidationSource,
} from "./auth-diagnostics";
import {
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "./session-token";
import {
  ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  getAdminSessionLifetimeRejection,
  isAdminSessionRevoked,
  isAdminSessionCurrentAt,
  shouldUpdateAdminSessionActivity,
} from "./session-policy";
import { revokeAdminSession } from "./session-revocation";
import { compareSessionPasswordChangeTimestamps } from "./session-password-change";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getValidTimestamp(value: unknown): number | null {
  if (!(value instanceof Date)) {
    return null;
  }

  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function revokeSession(sessionId: string): Promise<void> {
  await revokeAdminSession(sessionId, {
    updateMany: (args) => prisma.adminSession.updateMany(args),
  });
}

async function getSessionPasswordChangeComparison(
  sessionId: string,
  userId: string,
): Promise<ReturnType<typeof compareSessionPasswordChangeTimestamps>> {
  const [timestamps] = await prisma.$queryRaw<{
    sessionCreatedAtEpochMicros: string;
    passwordChangedAtEpochMicros: string;
    sessionCreatedAt: string;
    passwordChangedAt: string;
  }[]>`
    SELECT
      floor(extract(epoch FROM admin_session."createdAt") * 1000000)::bigint::text
        AS "sessionCreatedAtEpochMicros",
      floor(extract(epoch FROM admin_user."passwordChangedAt") * 1000000)::bigint::text
        AS "passwordChangedAtEpochMicros",
      to_char(
        admin_session."createdAt" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "sessionCreatedAt",
      to_char(
        admin_user."passwordChangedAt" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "passwordChangedAt"
    FROM "AdminSession" AS admin_session
    INNER JOIN "AdminUser" AS admin_user
      ON admin_user."id" = admin_session."userId"
    WHERE admin_session."id" = ${sessionId}
      AND admin_session."userId" = ${userId}
      AND admin_session."revokedAt" IS NULL
  `;

  if (!timestamps) return null;

  return compareSessionPasswordChangeTimestamps(
    timestamps.sessionCreatedAtEpochMicros,
    timestamps.passwordChangedAtEpochMicros,
    timestamps.sessionCreatedAt,
    timestamps.passwordChangedAt,
  );
}

async function isSessionStillCurrent(
  sessionId: string,
  userId: string,
  now: number,
): Promise<boolean> {
  const session = await prisma.adminSession.findUnique({
    where: { id: sessionId },
    select: {
      createdAt: true,
      expiresAt: true,
      lastSeenAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
  });

  if (
    !session ||
    isAdminSessionRevoked(session.revokedAt) ||
    session.user.id !== userId ||
    !session.user.isActive ||
    !isAdminSessionCurrentAt(session.expiresAt, session.lastSeenAt, now)
  ) {
    return false;
  }

  const passwordTimestampComparison = await getSessionPasswordChangeComparison(
    sessionId,
    userId,
  );

  return passwordTimestampComparison?.isNewer === true;
}

async function updateSessionActivity(
  sessionId: string,
  userId: string,
  lastSeenAt: Date,
  now: number,
): Promise<boolean> {
  if (!shouldUpdateAdminSessionActivity(lastSeenAt, now)) {
    return true;
  }

  const nowDate = new Date(now);
  const idleCutoff = new Date(now - ADMIN_SESSION_IDLE_TIMEOUT_MS);
  const updateCutoff = new Date(now - ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS);
  const updatedSessions = await prisma.$executeRaw`
    UPDATE "AdminSession" AS admin_session
    SET "lastSeenAt" = ${nowDate}
    FROM "AdminUser" AS admin_user
    WHERE admin_session."id" = ${sessionId}
      AND admin_session."userId" = ${userId}
      AND admin_user."id" = admin_session."userId"
      AND admin_session."revokedAt" IS NULL
      AND admin_user."isActive" = TRUE
      AND admin_session."createdAt" > admin_user."passwordChangedAt"
      AND admin_session."expiresAt" > ${nowDate}
      AND admin_session."lastSeenAt" > ${idleCutoff}
      AND admin_session."lastSeenAt" <= ${updateCutoff}
  `;

  if (updatedSessions === 1) {
    return true;
  }

  // Another request may have refreshed this session first. Re-read after a
  // conditional update miss so concurrent authenticated requests stay valid.
  return isSessionStillCurrent(sessionId, userId, now);
}

export interface ValidatedAdminSession {
  sessionId: string;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    role: AdminRole;
  };
}

export async function validateAdminSession(
  token: string,
  source: AuthValidationSource = "other",
): Promise<ValidatedAdminSession | null> {
  const reject = (reason: AuthDiagnosticReason): null => {
    const databaseIdentity = getPrismaDatabaseIdentity();
    logAdminAuthDiagnostic(
      {
        boundary: "session-validator",
        source,
        outcome: "rejected",
        phase: "session-policy",
        reason,
        databaseTargetSource: databaseIdentity.source === "uninitialized"
          ? undefined
          : databaseIdentity.source,
      },
      databaseIdentity.target,
    );
    return null;
  };

  try {
    if (process.env.NODE_ENV === "development") {
      if (!isCurrentDevelopmentSessionToken(token)) {
        return reject("invalid-development-token");
      }
    } else if (!SESSION_TOKEN_PATTERN.test(token)) {
      return reject("invalid-token-format");
    }

    const session = await prisma.adminSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        lastSeenAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            passwordChangedAt: true,
          },
        },
      },
    });

    if (!session) return reject("session-not-found");
    if (isAdminSessionRevoked(session.revokedAt)) return reject("session-revoked");

    const createdAt = getValidTimestamp(session.createdAt);
    const expiresAt = getValidTimestamp(session.expiresAt);
    const lastSeenAt = getValidTimestamp(session.lastSeenAt);
    const passwordChangedAt = getValidTimestamp(session.user.passwordChangedAt);

    if (
      createdAt === null ||
      expiresAt === null ||
      lastSeenAt === null ||
      passwordChangedAt === null
    ) {
      await revokeSession(session.id);
      return reject("invalid-session-timestamp");
    }

    const passwordTimestampComparison = await getSessionPasswordChangeComparison(
      session.id,
      session.user.id,
    );

    if (!passwordTimestampComparison) {
      await revokeSession(session.id);
      return reject("password-change-state-unavailable");
    }

    logAdminAuthDiagnostic({
      boundary: "session-validator",
      source,
      outcome: passwordTimestampComparison.isNewer ? "accepted" : "rejected",
      phase: "password-change-timestamp",
      reason: passwordTimestampComparison.isNewer
        ? undefined
        : "session-not-after-password-change",
      sessionCreatedAt: passwordTimestampComparison.sessionCreatedAt,
      passwordChangedAt: passwordTimestampComparison.passwordChangedAt,
      comparisonOperator: ">",
      timestampsEqual: passwordTimestampComparison.isEqual,
      comparisonResult: passwordTimestampComparison.isNewer,
    });

    if (!passwordTimestampComparison.isNewer) {
      await revokeSession(session.id);
      return reject("session-not-after-password-change");
    }

    const now = Date.now();

    if (!session.user.isActive) return reject("inactive-account");

    const lifetimeRejection = getAdminSessionLifetimeRejection(
      session.expiresAt,
      session.lastSeenAt,
      now,
    );
    if (lifetimeRejection !== null) return reject(lifetimeRejection);

    if (
      !(await updateSessionActivity(
        session.id,
        session.user.id,
        session.lastSeenAt,
        now,
      ))
    ) {
      return reject("activity-revalidation-failed");
    }

    const databaseIdentity = getPrismaDatabaseIdentity();
    logAdminAuthDiagnostic(
      {
        boundary: "session-validator",
        source,
        outcome: "accepted",
        phase: "session-policy",
        role: session.user.role,
        databaseTargetSource: databaseIdentity.source === "uninitialized"
          ? undefined
          : databaseIdentity.source,
      },
      databaseIdentity.target,
    );

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      user: {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      },
    };
  } catch (error) {
    const databaseIdentity = getPrismaDatabaseIdentity();
    logAdminAuthDiagnostic(
      {
        boundary: "session-validator",
        source,
        outcome: "failed",
        phase: "session-lookup",
        reason: "database-error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        databaseTargetSource: databaseIdentity.source === "uninitialized"
          ? undefined
          : databaseIdentity.source,
      },
      databaseIdentity.target,
    );
    throw error;
  }
}
