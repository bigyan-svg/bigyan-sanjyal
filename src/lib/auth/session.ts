import "server-only";

import type { AdminRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "./session-token";
import {
  ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  isAdminSessionCurrentAt,
  shouldUpdateAdminSessionActivity,
} from "./session-policy";
import { revokeAdminSession } from "./session-revocation";

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
    session.revokedAt !== null ||
    session.user.id !== userId ||
    !session.user.isActive ||
    !isAdminSessionCurrentAt(session.expiresAt, session.lastSeenAt, now)
  ) {
    return false;
  }

  const [passwordTimestampComparison] = await prisma.$queryRaw<
    { isOlderThanPasswordChange: boolean | null }[]
  >`
    SELECT (
      admin_session."createdAt" < admin_user."passwordChangedAt"
    ) AS "isOlderThanPasswordChange"
    FROM "AdminSession" AS admin_session
    INNER JOIN "AdminUser" AS admin_user
      ON admin_user."id" = admin_session."userId"
    WHERE admin_session."id" = ${sessionId}
      AND admin_session."userId" = ${userId}
      AND admin_session."revokedAt" IS NULL
  `;

  return passwordTimestampComparison?.isOlderThanPasswordChange === false;
}

async function updateSessionActivity(
  sessionId: string,
  userId: string,
  createdAt: Date,
  lastSeenAt: Date,
  now: number,
): Promise<boolean> {
  if (!shouldUpdateAdminSessionActivity(lastSeenAt, now)) {
    return true;
  }

  const nowDate = new Date(now);
  const idleCutoff = new Date(now - ADMIN_SESSION_IDLE_TIMEOUT_MS);
  const updateCutoff = new Date(now - ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS);
  const result = await prisma.adminSession.updateMany({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { gt: nowDate },
      lastSeenAt: { gt: idleCutoff, lte: updateCutoff },
      user: {
        is: {
          isActive: true,
          passwordChangedAt: { lte: createdAt },
        },
      },
    },
    data: { lastSeenAt: nowDate },
  });

  if (result.count === 1) {
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
): Promise<ValidatedAdminSession | null> {
  if (process.env.NODE_ENV === "development") {
    if (!isCurrentDevelopmentSessionToken(token)) {
      return null;
    }
  } else if (!SESSION_TOKEN_PATTERN.test(token)) {
    return null;
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

  if (!session || session.revokedAt !== null) {
    return null;
  }

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
    return null;
  }

  const [passwordTimestampComparison] = await prisma.$queryRaw<
    { isOlderThanPasswordChange: boolean | null }[]
  >`
    SELECT (
      admin_session."createdAt" < admin_user."passwordChangedAt"
    ) AS "isOlderThanPasswordChange"
    FROM "AdminSession" AS admin_session
    INNER JOIN "AdminUser" AS admin_user
      ON admin_user."id" = admin_session."userId"
    WHERE admin_session."id" = ${session.id}
      AND admin_session."userId" = ${session.user.id}
      AND admin_session."revokedAt" IS NULL
  `;

  if (
    !passwordTimestampComparison ||
    typeof passwordTimestampComparison.isOlderThanPasswordChange !== "boolean"
  ) {
    await revokeSession(session.id);
    return null;
  }

  if (passwordTimestampComparison.isOlderThanPasswordChange) {
    await revokeSession(session.id);
    return null;
  }

  const now = Date.now();

  if (
    !session.user.isActive ||
    !isAdminSessionCurrentAt(session.expiresAt, session.lastSeenAt, now)
  ) {
    return null;
  }

  if (
    !(await updateSessionActivity(
      session.id,
      session.user.id,
      session.createdAt,
      session.lastSeenAt,
      now,
    ))
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    user: {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    },
  };
}
