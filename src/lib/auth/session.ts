import "server-only";

import type { AdminRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "./session-token";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getValidTimestamp(value: unknown): number | null {
  if (!(value instanceof Date)) {
    return null;
  }

  const timestamp = value.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function revokeSession(sessionId: string): Promise<void> {
  await prisma.adminSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
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
  const passwordChangedAt = getValidTimestamp(session.user.passwordChangedAt);

  if (createdAt === null || expiresAt === null || passwordChangedAt === null) {
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

  if (expiresAt <= Date.now() || !session.user.isActive) {
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
