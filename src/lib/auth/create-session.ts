import "server-only";

import { randomUUID } from "node:crypto";
import { getPrismaDatabaseIdentity, prisma } from "@/lib/prisma";
import { logAdminAuthDiagnostic } from "./auth-diagnostics";
import { generateSessionToken, hashSessionToken } from "./session-token";

const DEFAULT_SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateAdminSessionOptions {
  expectedPasswordHash: string;
  lifetimeMs?: number;
}

export interface CreatedAdminSession {
  token: string;
}

export async function createAdminSession(
  adminUserId: string,
  options: CreateAdminSessionOptions,
): Promise<CreatedAdminSession> {
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS;

  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
    throw new RangeError("Session lifetime must be a positive safe integer in milliseconds.");
  }

  const expiresAt = new Date(Date.now() + lifetimeMs);

  if (Number.isNaN(expiresAt.getTime())) {
    throw new RangeError("Session lifetime produces an invalid expiration date.");
  }

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  await prisma.$transaction(async (transaction) => {
    const [adminUser] = await transaction.$queryRaw<
      { id: string; isActive: boolean; passwordHashMatches: boolean }[]
    >`
      SELECT
        "id",
        "isActive",
        "passwordHash" = ${options.expectedPasswordHash} AS "passwordHashMatches"
      FROM "AdminUser"
      WHERE "id" = ${adminUserId}
      FOR UPDATE
    `;

    if (!adminUser || !adminUser.isActive || !adminUser.passwordHashMatches) {
      throw new Error("Cannot create a session for a missing, inactive, or changed admin user.");
    }

    const createdSessions = await transaction.$executeRaw`
      WITH session_clock AS (
        SELECT
          admin_user."id" AS "userId",
          GREATEST(
            clock_timestamp(),
            admin_user."passwordChangedAt" + INTERVAL '1 microsecond'
          ) AS "createdAt"
        FROM "AdminUser" AS admin_user
        WHERE admin_user."id" = ${adminUser.id}
          AND admin_user."isActive" = TRUE
          AND admin_user."passwordHash" = ${options.expectedPasswordHash}
      )
      INSERT INTO "AdminSession" (
        "id",
        "userId",
        "tokenHash",
        "createdAt",
        "lastSeenAt",
        "expiresAt"
      )
      SELECT
        ${randomUUID()}::uuid,
        session_clock."userId",
        ${tokenHash},
        session_clock."createdAt",
        session_clock."createdAt",
        session_clock."createdAt" + (${lifetimeMs} * INTERVAL '1 millisecond')
      FROM session_clock
    `;

    if (createdSessions !== 1) {
      throw new Error("Unable to persist the admin session.");
    }
  });

  const databaseIdentity = getPrismaDatabaseIdentity();
  logAdminAuthDiagnostic(
    {
      boundary: "session-create",
      outcome: "persisted",
      databaseTargetSource: databaseIdentity.source === "uninitialized"
        ? undefined
        : databaseIdentity.source,
    },
    databaseIdentity.target,
  );

  return { token };
}
