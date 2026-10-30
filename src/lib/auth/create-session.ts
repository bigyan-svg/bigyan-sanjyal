import "server-only";

import { prisma } from "@/lib/prisma";
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

    await transaction.adminSession.create({
      data: {
        userId: adminUser.id,
        tokenHash,
        expiresAt,
      },
      select: { id: true },
    });
  });

  return { token };
}
