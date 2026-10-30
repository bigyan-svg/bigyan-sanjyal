import "server-only";

import { createAdminSession } from "@/lib/auth/create-session";
import { setAdminSessionCookie } from "@/lib/auth/cookies";
import { checkAdminLoginRateLimit } from "@/lib/auth/login-rate-limit";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { verifyAdminPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
// Generated once from random input using Argon2id defaults (m=65536, t=3, p=4).
const DUMMY_ADMIN_PASSWORD_HASH = "$argon2id$v=19$m=65536,p=4,t=3$Mk1ajqbKrkWotiK7xRo7qQ$ebsItKOPDeGs5antfZu8rKBolBSnNo1zAKNeCALnNbs";

class PayloadTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

interface LoginCredentials {
  email: string;
  password: string;
}

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

function parseCredentials(body: unknown): LoginCredentials | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const values = body as Record<string, unknown>;

  if (typeof values.email !== "string" || typeof values.password !== "string") {
    return null;
  }

  const email = values.email.trim().toLowerCase();

  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(email) ||
    values.password.length > MAX_PASSWORD_LENGTH
  ) {
    return null;
  }

  return { email, password: values.password };
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedRequestOrigin(request)) {
    return jsonError("Invalid request.", 403);
  }

  if (!hasJsonContentType(request)) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  let body: unknown;

  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return jsonError("Request body is too large.", 413);
    }

    return jsonError("Invalid request.", 400);
  }

  const credentials = parseCredentials(body);

  if (!credentials) {
    return jsonError("Invalid request.", 400);
  }

  const rateLimit = await checkAdminLoginRateLimit(request, credentials.email);

  if (rateLimit.status === "unavailable") {
    return jsonError("Login is temporarily unavailable.", 503);
  }

  if (rateLimit.status === "limited") {
    return jsonError(
      "Too many sign-in attempts. Please try again later.",
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

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

      return jsonError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const passwordMatches = await verifyAdminPassword(
      credentials.password,
      adminUser.passwordHash,
    );

    if (!passwordMatches) {
      return jsonError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const session = await createAdminSession(adminUser.id, {
      expectedPasswordHash: adminUser.passwordHash,
    });
    await setAdminSessionCookie(session.token);

    return Response.json(
      { success: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError("Unable to process the login request.", 500);
  }
}
