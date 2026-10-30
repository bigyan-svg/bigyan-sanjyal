import "server-only";

import { cookies } from "next/headers";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { validateAdminSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { publicSiteProfileSelect } from "@/lib/site-profile";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_HEADLINE_LENGTH = 160;
const MAX_SHORT_BIO_LENGTH = 300;
const MAX_BIOGRAPHY_LENGTH = 10_000;
const MAX_AVATAR_URL_LENGTH = 2_048;

type ProfileField = "displayName" | "headline" | "shortBio" | "biography" | "avatarUrl";
type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

interface ProfileUpdate {
  displayName: string;
  headline: string | null;
  shortBio: string | null;
  biography: string | null;
  avatarUrl: string | null;
}

class InvalidRequestBodyError extends Error {}
class PayloadTooLargeError extends Error {}

function jsonResponse(body: unknown, status: number): Response {
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

function characterLength(value: string): number {
  return Array.from(value).length;
}

function sanitizeSingleLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sanitizeMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .trim();
}

function parseOptionalText(
  value: unknown,
  field: Exclude<ProfileField, "displayName" | "avatarUrl">,
  maxLength: number,
  multiline: boolean,
  errors: ProfileFieldErrors,
): string | null | undefined {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    errors[field] = "Enter text for this field.";
    return undefined;
  }

  const sanitized = multiline ? sanitizeMultiline(value) : sanitizeSingleLine(value);

  if (characterLength(sanitized) > maxLength) {
    errors[field] = `Use ${maxLength.toLocaleString()} characters or fewer.`;
    return undefined;
  }

  return sanitized || null;
}

function parseAvatarUrl(value: unknown, errors: ProfileFieldErrors): string | null | undefined {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    errors.avatarUrl = "Enter an HTTPS URL.";
    return undefined;
  }

  const candidate = value.trim();

  if (candidate.length > MAX_AVATAR_URL_LENGTH) {
    errors.avatarUrl = `Use ${MAX_AVATAR_URL_LENGTH.toLocaleString()} characters or fewer.`;
    return undefined;
  }

  try {
    const url = new URL(candidate);

    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
      errors.avatarUrl = "Enter a valid HTTPS URL without embedded credentials.";
      return undefined;
    }

    return url.href;
  } catch {
    errors.avatarUrl = "Enter a valid HTTPS URL.";
    return undefined;
  }
}

function parseProfileUpdate(body: unknown):
  | { data: ProfileUpdate; errors: null }
  | { data: null; errors: ProfileFieldErrors; invalidShape?: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const values = body as Record<string, unknown>;
  const allowedFields = new Set<ProfileField>([
    "displayName",
    "headline",
    "shortBio",
    "biography",
    "avatarUrl",
  ]);

  if (Object.keys(values).some((key) => !allowedFields.has(key as ProfileField))) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: ProfileFieldErrors = {};
  const displayName =
    typeof values.displayName === "string" ? sanitizeSingleLine(values.displayName) : "";

  if (!displayName) {
    errors.displayName = "Display name is required.";
  } else if (characterLength(displayName) > MAX_DISPLAY_NAME_LENGTH) {
    errors.displayName = `Use ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`;
  }

  const headline = parseOptionalText(
    values.headline,
    "headline",
    MAX_HEADLINE_LENGTH,
    false,
    errors,
  );
  const shortBio = parseOptionalText(
    values.shortBio,
    "shortBio",
    MAX_SHORT_BIO_LENGTH,
    false,
    errors,
  );
  const biography = parseOptionalText(
    values.biography,
    "biography",
    MAX_BIOGRAPHY_LENGTH,
    true,
    errors,
  );
  const avatarUrl = parseAvatarUrl(values.avatarUrl, errors);

  if (
    Object.keys(errors).length > 0 ||
    headline === undefined ||
    shortBio === undefined ||
    biography === undefined ||
    avatarUrl === undefined
  ) {
    return { data: null, errors };
  }

  return {
    data: { displayName, headline, shortBio, biography, avatarUrl },
    errors: null,
  };
}

export async function PUT(request: Request): Promise<Response> {
  if (!hasTrustedRequestOrigin(request)) {
    return jsonResponse({ error: "Invalid request." }, 403);
  }

  if (!hasJsonContentType(request)) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateAdminSession(token) : null;

    if (!session) {
      return jsonResponse({ error: "Authentication is required." }, 401);
    }

    if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
      return jsonResponse({ error: "You are not authorized to edit the profile." }, 403);
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

    const parsed = parseProfileUpdate(body);

    if ("invalidShape" in parsed && parsed.invalidShape) {
      return jsonResponse({ error: "Invalid profile data." }, 400);
    }

    if (!parsed.data) {
      return jsonResponse(
        { error: "Please correct the highlighted fields.", fields: parsed.errors },
        422,
      );
    }

    const update = await prisma.siteProfile.updateMany({
      where: { id: 1 },
      data: parsed.data,
    });

    if (update.count !== 1) {
      return jsonResponse({ error: "The site profile is unavailable." }, 404);
    }

    const profile = await prisma.siteProfile.findUnique({
      where: { id: 1 },
      select: publicSiteProfileSelect,
    });

    if (!profile) {
      return jsonResponse({ error: "The site profile is unavailable." }, 404);
    }

    return jsonResponse({ success: true, profile }, 200);
  } catch {
    return jsonResponse({ error: "Unable to save the profile. Please try again." }, 500);
  }
}
