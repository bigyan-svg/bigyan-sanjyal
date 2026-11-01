import "server-only";

import {
  JsonRequestTooLargeError,
  readJsonRequest,
} from "./json-request";
import type { ContactRateLimitResult } from "./auth/login-rate-limit";

export const CONTACT_REQUEST_MAX_BYTES = 64 * 1024;
export const CONTACT_NAME_MAX_LENGTH = 120;
export const CONTACT_EMAIL_MAX_LENGTH = 320;
export const CONTACT_SUBJECT_MAX_LENGTH = 200;
export const CONTACT_MESSAGE_MAX_LENGTH = 10_000;

const ALLOWED_CONTACT_FIELDS = new Set(["name", "email", "subject", "message", "website"]);
const EMAIL_LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/iu;
const EMAIL_DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export interface ContactMessageInput {
  name: string;
  email: string;
  subject: string | null;
  message: string;
}

export type NewContactMessageInput = ContactMessageInput & { status: "NEW" };

type ContactField = keyof ContactMessageInput;
type ContactFieldErrors = Partial<Record<ContactField, string>>;

type ParsedContactSubmission =
  | { kind: "invalid-shape" }
  | { kind: "honeypot" }
  | { kind: "invalid-fields"; errors: ContactFieldErrors }
  | { kind: "valid"; data: ContactMessageInput };

export interface ContactSubmissionDependencies {
  isTrustedOrigin(request: Request): boolean;
  checkRateLimit(request: Request): Promise<ContactRateLimitResult>;
  createMessage(input: NewContactMessageInput): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lengthInCharacters(value: string): number {
  return Array.from(value).length;
}

function normalizeSingleLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeMessage(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .trim();
}

function isValidEmail(email: string): boolean {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@")) return false;

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (
    localPart.length > 64 ||
    !EMAIL_LOCAL_PART.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    domain.length > 253
  ) {
    return false;
  }

  const domainLabels = domain.split(".");
  return domainLabels.length >= 2 && domainLabels.every((label) => EMAIL_DOMAIN_LABEL.test(label));
}

function parseContactSubmission(body: unknown): ParsedContactSubmission {
  if (
    !isRecord(body) ||
    Object.keys(body).some((field) => !ALLOWED_CONTACT_FIELDS.has(field)) ||
    (Object.hasOwn(body, "website") && typeof body.website !== "string")
  ) {
    return { kind: "invalid-shape" };
  }

  if (typeof body.website === "string" && body.website.trim() !== "") {
    return { kind: "honeypot" };
  }

  const errors: ContactFieldErrors = {};
  const rawName = typeof body.name === "string" ? body.name : "";
  const name = normalizeSingleLine(rawName);
  if (!name) errors.name = "Enter your name.";
  else if (lengthInCharacters(name) > CONTACT_NAME_MAX_LENGTH) {
    errors.name = `Use ${CONTACT_NAME_MAX_LENGTH} characters or fewer.`;
  }

  const rawEmail = typeof body.email === "string" ? body.email : "";
  const email = rawEmail.normalize("NFC").trim().toLowerCase();
  if (!email) errors.email = "Enter your email address.";
  else if (
    lengthInCharacters(email) > CONTACT_EMAIL_MAX_LENGTH ||
    !isValidEmail(email)
  ) {
    errors.email = "Enter a valid email address.";
  }

  let subject: string | null = null;
  if (body.subject !== undefined && body.subject !== null) {
    if (typeof body.subject !== "string") {
      errors.subject = "Enter text for this field.";
    } else {
      subject = normalizeSingleLine(body.subject) || null;
      if (subject && lengthInCharacters(subject) > CONTACT_SUBJECT_MAX_LENGTH) {
        errors.subject = `Use ${CONTACT_SUBJECT_MAX_LENGTH} characters or fewer.`;
      }
    }
  }

  const rawMessage = typeof body.message === "string" ? body.message : "";
  const message = normalizeMessage(rawMessage);
  if (!message) errors.message = "Enter a message.";
  else if (lengthInCharacters(message) > CONTACT_MESSAGE_MAX_LENGTH) {
    errors.message = `Use ${CONTACT_MESSAGE_MAX_LENGTH.toLocaleString()} characters or fewer.`;
  }

  if (Object.keys(errors).length > 0) return { kind: "invalid-fields", errors };
  return { kind: "valid", data: { name, email, subject, message } };
}

function jsonResponse(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers });
}

function retryAfterHeader(seconds: number): string | undefined {
  return Number.isSafeInteger(seconds) && seconds > 0 ? String(seconds) : undefined;
}

export async function handleContactSubmission(
  request: Request,
  dependencies: ContactSubmissionDependencies,
): Promise<Response> {
  if (!dependencies.isTrustedOrigin(request)) {
    return jsonResponse({ error: "Invalid request." }, 403);
  }

  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return jsonResponse({ error: "Content-Type must be application/json." }, 415);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request, CONTACT_REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? jsonResponse({ error: "Request body is too large." }, 413)
      : jsonResponse({ error: "Invalid request." }, 400);
  }

  let rateLimit: ContactRateLimitResult;
  try {
    rateLimit = await dependencies.checkRateLimit(request);
  } catch {
    return jsonResponse(
      { error: "Message submission is temporarily unavailable. Please try again later." },
      503,
    );
  }
  if (rateLimit.status === "unavailable") {
    return jsonResponse(
      { error: "Message submission is temporarily unavailable. Please try again later." },
      503,
    );
  }
  if (rateLimit.status === "limited") {
    const retryAfter = retryAfterHeader(rateLimit.retryAfterSeconds);
    return jsonResponse(
      { error: "Too many submissions. Please try again later." },
      429,
      retryAfter ? { "Retry-After": retryAfter } : undefined,
    );
  }

  const parsed = parseContactSubmission(body);
  if (parsed.kind === "invalid-shape") {
    return jsonResponse({ error: "Invalid message data." }, 400);
  }
  if (parsed.kind === "honeypot") {
    return jsonResponse({ success: true }, 201);
  }
  if (parsed.kind === "invalid-fields") {
    return jsonResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    await dependencies.createMessage({ ...parsed.data, status: "NEW" });
    return jsonResponse({ success: true }, 201);
  } catch {
    return jsonResponse(
      { error: "Unable to submit your message. Please try again later." },
      500,
    );
  }
}
