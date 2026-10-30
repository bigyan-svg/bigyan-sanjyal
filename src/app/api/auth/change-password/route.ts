import "server-only";

import { cookies } from "next/headers";
import { clearAdminSessionCookie } from "@/lib/auth/cookies";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { checkAdminPasswordChangeRateLimit } from "@/lib/auth/login-rate-limit";
import { hashAdminPassword, verifyAdminPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";
import { validateAdminSession } from "@/lib/auth/session";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PASSWORD_LENGTH = 1_024;
const MIN_NEW_PASSWORD_LENGTH = 12;
const PASSWORD_CHANGE_ERROR = "Unable to change password.";

class PayloadTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}
class SessionStateChangedError extends Error {}

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

function jsonResponse(
  body: { success: true } | { error: string },
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      throw new InvalidRequestBodyError();
    }

    const declaredLength = Number(contentLength);

    if (!Number.isSafeInteger(declaredLength)) {
      throw new InvalidRequestBodyError();
    }

    if (declaredLength > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
  }

  const reader = request.body?.getReader();

  if (!reader) {
    throw new InvalidRequestBodyError();
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const bodyText = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    return JSON.parse(bodyText) as unknown;
  } catch {
    throw new InvalidRequestBodyError();
  }
}

function parsePasswordChangeInput(body: unknown): PasswordChangeInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const values = body as Record<string, unknown>;

  if (
    typeof values.currentPassword !== "string" ||
    typeof values.newPassword !== "string" ||
    typeof values.confirmNewPassword !== "string"
  ) {
    return null;
  }

  const { currentPassword, newPassword, confirmNewPassword } = values;

  if (
    currentPassword.length === 0 ||
    currentPassword.length > MAX_PASSWORD_LENGTH ||
    newPassword.length > MAX_PASSWORD_LENGTH ||
    confirmNewPassword.length > MAX_PASSWORD_LENGTH ||
    Array.from(newPassword).length < MIN_NEW_PASSWORD_LENGTH ||
    newPassword !== confirmNewPassword
  ) {
    return null;
  }

  return { currentPassword, newPassword };
}

async function changePasswordTransaction(
  userId: string,
  sessionId: string,
  currentPasswordHash: string,
  newPasswordHash: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const updatedUsers = await transaction.$executeRaw`
      UPDATE "AdminUser" AS admin_user
      SET
        "passwordHash" = ${newPasswordHash},
        "passwordChangedAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
      WHERE admin_user."id" = ${userId}
        AND admin_user."isActive" = TRUE
        AND admin_user."passwordHash" = ${currentPasswordHash}
        AND EXISTS (
          SELECT 1
          FROM "AdminSession" AS admin_session
          WHERE admin_session."id" = ${sessionId}
            AND admin_session."userId" = admin_user."id"
            AND admin_session."revokedAt" IS NULL
            AND admin_session."expiresAt" > clock_timestamp()
            AND admin_session."createdAt" >= admin_user."passwordChangedAt"
        )
    `;

    if (updatedUsers !== 1) {
      throw new SessionStateChangedError();
    }

    await transaction.$executeRaw`
      UPDATE "AdminSession" AS admin_session
      SET "revokedAt" = clock_timestamp()
      WHERE admin_session."userId" = ${userId}
        AND admin_session."revokedAt" IS NULL
    `;
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedRequestOrigin(request)) {
    return jsonResponse({ error: "Invalid request." }, 403);
  }

  if (!hasJsonContentType(request)) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateAdminSession(token) : null;

    if (!session) {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
    }

    const rateLimit = await checkAdminPasswordChangeRateLimit(
      request,
      session.user.id,
    );

    if (rateLimit.status === "unavailable") {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 503);
    }

    if (rateLimit.status === "limited") {
      return Response.json(
        { error: "Too many password-change attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    let body: unknown;

    try {
      body = await readJsonBody(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return jsonResponse({ error: "Request body is too large." }, 413);
      }

      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const input = parsePasswordChangeInput(body);

    if (!input) {
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const adminUser = await prisma.adminUser.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (
      !adminUser ||
      !adminUser.isActive ||
      !(await verifyAdminPassword(input.currentPassword, adminUser.passwordHash))
    ) {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
    }

    if (input.currentPassword === input.newPassword) {
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const newPasswordHash = await hashAdminPassword(input.newPassword);

    try {
      await changePasswordTransaction(
        adminUser.id,
        session.sessionId,
        adminUser.passwordHash,
        newPasswordHash,
      );
    } catch (error) {
      if (error instanceof SessionStateChangedError) {
        return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
      }

      throw error;
    }

    await clearAdminSessionCookie();

    return jsonResponse({ success: true }, 200);
  } catch {
    return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 500);
  }
}
