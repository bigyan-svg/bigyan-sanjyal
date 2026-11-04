import "server-only";

import { cookies } from "next/headers";
import { clearAdminSessionCookie } from "@/lib/auth/cookies";
import { checkAdminPasswordChangeRateLimit } from "@/lib/auth/login-rate-limit";
import {
  updatePasswordAndRevokeSessions,
  type PasswordChangeExecuteRaw,
} from "@/lib/auth/password-change-transaction";
import { handlePasswordChange } from "@/lib/auth/password-change";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { validateAdminSession } from "@/lib/auth/session";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export async function POST(request: Request): Promise<Response> {
  return handlePasswordChange(request, {
    isTrustedOrigin: hasTrustedRequestOrigin,
    getSessionToken: async () => {
      const cookieStore = await cookies();
      return cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
    },
    validateSession: validateAdminSession,
    checkRateLimit: checkAdminPasswordChangeRateLimit,
    findAdminUser: (adminUserId) =>
      prisma.adminUser.findUnique({
        where: { id: adminUserId },
        select: {
          id: true,
          passwordHash: true,
          isActive: true,
        },
      }),
    verifyPassword: verifyAdminPassword,
    hashPassword: hashAdminPassword,
    updatePasswordAndRevokeSessions: async (
      userId,
      sessionId,
      currentPasswordHash,
      newPasswordHash,
    ) => {
      await prisma.$transaction(async (transaction) => {
        const executeRaw: PasswordChangeExecuteRaw = (query, ...values) =>
          transaction.$executeRaw(query, ...values);

        await updatePasswordAndRevokeSessions(executeRaw, {
          userId,
          sessionId,
          currentPasswordHash,
          newPasswordHash,
        });
      });
    },
    clearSessionCookie: clearAdminSessionCookie,
  });
}
