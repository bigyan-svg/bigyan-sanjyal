import "server-only";

import { PasswordChangeSessionStateChangedError } from "./password-change-transaction";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_PASSWORD_LENGTH = 1_024;
const MIN_NEW_PASSWORD_LENGTH = 12;
const PASSWORD_CHANGE_ERROR = "Unable to change password.";

class PayloadTooLargeError extends Error {}
class InvalidRequestBodyError extends Error {}

export interface PasswordChangeSession {
  sessionId: string;
  user: { id: string };
}

export interface PasswordChangeAdminUser {
  id: string;
  passwordHash: string;
  isActive: boolean;
}

export type PasswordChangeRateLimitResult =
  | { status: "allowed" }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export interface PasswordChangeDependencies {
  isTrustedOrigin(request: Request): boolean;
  getSessionToken(): Promise<string | undefined>;
  validateSession(token: string): Promise<PasswordChangeSession | null>;
  checkRateLimit(
    request: Request,
    adminUserId: string,
  ): Promise<PasswordChangeRateLimitResult>;
  findAdminUser(adminUserId: string): Promise<PasswordChangeAdminUser | null>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
  hashPassword(password: string): Promise<string>;
  updatePasswordAndRevokeSessions(
    userId: string,
    sessionId: string,
    currentPasswordHash: string,
    newPasswordHash: string,
  ): Promise<void>;
  clearSessionCookie(): Promise<void>;
}

interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

function jsonResponse(
  body: { success: true } | { error: string },
  status: number,
  additionalHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...additionalHeaders },
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
  const allowedFields = new Set([
    "currentPassword",
    "newPassword",
    "confirmNewPassword",
  ]);

  if (Object.keys(values).some((key) => !allowedFields.has(key))) {
    return null;
  }

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

export async function handlePasswordChange(
  request: Request,
  dependencies: PasswordChangeDependencies,
): Promise<Response> {
  if (!dependencies.isTrustedOrigin(request)) {
    return jsonResponse({ error: "Invalid request." }, 403);
  }

  if (!hasJsonContentType(request)) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  try {
    const token = await dependencies.getSessionToken();
    const session = token ? await dependencies.validateSession(token) : null;

    if (!session) {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
    }

    const rateLimit = await dependencies.checkRateLimit(request, session.user.id);

    if (rateLimit.status === "unavailable") {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 503);
    }

    if (rateLimit.status === "limited") {
      return jsonResponse(
        { error: "Too many password-change attempts. Please try again later." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) },
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

    const adminUser = await dependencies.findAdminUser(session.user.id);

    if (
      !adminUser ||
      !adminUser.isActive ||
      !(await dependencies.verifyPassword(input.currentPassword, adminUser.passwordHash))
    ) {
      return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
    }

    if (input.currentPassword === input.newPassword) {
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const newPasswordHash = await dependencies.hashPassword(input.newPassword);

    try {
      await dependencies.updatePasswordAndRevokeSessions(
        adminUser.id,
        session.sessionId,
        adminUser.passwordHash,
        newPasswordHash,
      );
    } catch (error) {
      if (error instanceof PasswordChangeSessionStateChangedError) {
        return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 401);
      }

      throw error;
    }

    await dependencies.clearSessionCookie();

    return jsonResponse({ success: true }, 200);
  } catch {
    return jsonResponse({ error: PASSWORD_CHANGE_ERROR }, 500);
  }
}
