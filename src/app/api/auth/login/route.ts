import "server-only";

import { createAdminSession } from "@/lib/auth/create-session";
import { setAdminSessionCookie } from "@/lib/auth/cookies";
import { checkAdminLoginRateLimit } from "@/lib/auth/login-rate-limit";
import { createLoginRateLimitedResponse } from "@/lib/auth/login-rate-limit-response";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { verifyAdminPassword } from "@/lib/auth/password";
import { getPrismaDatabaseIdentity, prisma } from "@/lib/prisma";
import {
  logAdminAuthDiagnostic,
  type AuthDiagnosticPhase,
} from "@/lib/auth/auth-diagnostics";
import { getAdminSessionCookieOptions } from "@/lib/auth/session-cookie-options";
import { parseLoginCredentials } from "@/lib/auth/login-validation";

const MAX_BODY_BYTES = 8 * 1024;
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
// Generated once from random input using Argon2id defaults (m=65536, t=3, p=4).
const DUMMY_ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=65536,p=4,t=3$Mk1ajqbKrkWotiK7xRo7qQ$ebsItKOPDeGs5antfZu8rKBolBSnNo1zAKNeCALnNbs";

class PayloadTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

function jsonError(
  message: string,
  status: number,
  additionalHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: { "Cache-Control": "no-store", ...additionalHeaders },
    },
  );
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

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedRequestOrigin(request)) {
    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "rejected",
      phase: "origin-validation",
    });
    return jsonError("Invalid request.", 403);
  }

  if (!hasJsonContentType(request)) {
    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "rejected",
      phase: "content-type-validation",
    });
    return jsonError("Content-Type must be application/json.", 415);
  }

  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      logAdminAuthDiagnostic({
        boundary: "login-api",
        outcome: "rejected",
        phase: "request-validation",
      });
      return jsonError("Request body is too large.", 413);
    }

    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "rejected",
      phase: "request-validation",
    });
    return jsonError("Invalid request.", 400);
  }

  const credentials = parseLoginCredentials(body);

  if (!credentials) {
    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "rejected",
      phase: "request-validation",
    });
    return jsonError("Invalid request.", 400);
  }

  const rateLimit = await checkAdminLoginRateLimit(request, credentials.email);

  if (rateLimit.status === "unavailable") {
    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "failed",
      phase: "rate-limit",
      reason: rateLimit.reason,
    });
    return jsonError("Login is temporarily unavailable.", 503);
  }

  if (rateLimit.status === "limited") {
    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "rejected",
      phase: "rate-limit",
      reason: "rate-limited",
    });
    return createLoginRateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  let phase: AuthDiagnosticPhase = "credential-lookup";

  try {
    const adminUser = await prisma.adminUser.findUnique({
      where: { email: credentials.email },
      select: {
        id: true,
        passwordHash: true,
        isActive: true,
      },
    });

    if (!adminUser || !adminUser.isActive) {
      await verifyAdminPassword(
        credentials.password,
        DUMMY_ADMIN_PASSWORD_HASH,
      );

      logAdminAuthDiagnostic({
        boundary: "login-api",
        outcome: "rejected",
        phase: "password-verification",
        reason: "invalid-credentials",
      });
      return jsonError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    phase = "password-verification";
    const passwordMatches = await verifyAdminPassword(
      credentials.password,
      adminUser.passwordHash,
    );

    if (!passwordMatches) {
      logAdminAuthDiagnostic({
        boundary: "login-api",
        outcome: "rejected",
        phase,
        reason: "invalid-credentials",
      });
      return jsonError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "accepted",
      phase,
    });

    phase = "session-persistence";
    const session = await createAdminSession(adminUser.id, {
      expectedPasswordHash: adminUser.passwordHash,
    });

    phase = "cookie-issuance";
    await setAdminSessionCookie(session.token);

    const databaseIdentity = getPrismaDatabaseIdentity();
    const cookieOptions = getAdminSessionCookieOptions(
      process.env.NODE_ENV === "production",
    );
    logAdminAuthDiagnostic(
      {
        boundary: "login-cookie",
        outcome: "issued",
        cookieName: "admin_session",
        cookiePath: cookieOptions.path,
        httpOnly: cookieOptions.httpOnly,
        secure: cookieOptions.secure,
        sameSite: cookieOptions.sameSite,
        browserSession: true,
        databaseTargetSource: databaseIdentity.source === "uninitialized"
          ? undefined
          : databaseIdentity.source,
      },
      databaseIdentity.target,
    );

    logAdminAuthDiagnostic({
      boundary: "login-api",
      outcome: "accepted",
      phase: "cookie-issuance",
    });

    return Response.json(
      { success: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const databaseIdentity = getPrismaDatabaseIdentity();
    logAdminAuthDiagnostic(
      {
        boundary: "login-api",
        outcome: "failed",
        phase,
        reason: "database-error",
        errorName: error instanceof Error ? error.name : "UnknownError",
        databaseTargetSource: databaseIdentity.source === "uninitialized"
          ? undefined
          : databaseIdentity.source,
      },
      databaseIdentity.target,
    );
    return jsonError("Unable to process the login request.", 500);
  }
}
