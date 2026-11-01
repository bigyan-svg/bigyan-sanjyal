import {
  JsonRequestTooLargeError,
  readJsonRequest,
} from "./json-request";

export const ADMIN_MESSAGES_PAGE_SIZE = 20;
export const ADMIN_MESSAGE_REQUEST_MAX_BYTES = 4 * 1024;
export const ADMIN_MESSAGE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const ADMIN_MESSAGE_STATUSES = ["NEW", "READ", "ARCHIVED", "SPAM"] as const;

export type AdminMessageStatus = (typeof ADMIN_MESSAGE_STATUSES)[number];
export type AdminMessageStatusFilter = AdminMessageStatus | "ALL";

export interface AdminMessageListItem {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  status: AdminMessageStatus;
  createdAt: Date;
}

export interface AdminMessageDetail extends AdminMessageListItem {
  message: string;
  readAt: Date | null;
  updatedAt: Date;
}

export interface AdminMessageListQuery {
  status: AdminMessageStatus | null;
  skip: number;
  take: number;
}

export interface AdminMessageListDependencies {
  authorize(request: Request): Promise<Response | null>;
  findMessages(query: AdminMessageListQuery): Promise<AdminMessageListItem[]>;
  countMessages(status: AdminMessageStatus | null): Promise<number>;
  countNewMessages(): Promise<number>;
}

export type AdminMessageAction =
  | { kind: "open" }
  | { kind: "status"; status: AdminMessageStatus };

export interface AdminMessagePatchDependencies {
  authorize(request: Request): Promise<Response | null>;
  performAction(
    id: string,
    action: AdminMessageAction,
    now: Date,
  ): Promise<AdminMessageDetail | null>;
  now?: () => Date;
}

export interface ContactMessageState {
  status: AdminMessageStatus;
  readAt: Date | null;
}

export interface ContactMessageTransition extends ContactMessageState {
  changed: boolean;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isAdminMessageStatus(value: unknown): value is AdminMessageStatus {
  return typeof value === "string" &&
    ADMIN_MESSAGE_STATUSES.some((status) => status === value);
}

function parseListQuery(request: Request):
  | { ok: true; status: AdminMessageStatus | null; requestedPage: number }
  | { ok: false } {
  const searchParams = new URL(request.url).searchParams;
  const keys = [...searchParams.keys()];
  if (keys.some((key) => key !== "status" && key !== "page")) return { ok: false };

  const statuses = searchParams.getAll("status");
  const pages = searchParams.getAll("page");
  if (statuses.length > 1 || pages.length > 1) return { ok: false };

  const statusValue = statuses[0] ?? "ALL";
  if (statusValue !== "ALL" && !isAdminMessageStatus(statusValue)) {
    return { ok: false };
  }

  const pageValue = pages[0] ?? "1";
  if (!/^[1-9]\d{0,8}$/u.test(pageValue)) return { ok: false };
  const requestedPage = Number(pageValue);
  if (!Number.isSafeInteger(requestedPage)) return { ok: false };

  return {
    ok: true,
    status: statusValue === "ALL" ? null : statusValue,
    requestedPage,
  };
}

export async function handleAdminMessagesList(
  request: Request,
  dependencies: AdminMessageListDependencies,
): Promise<Response> {
  try {
    const authorizationError = await dependencies.authorize(request);
    if (authorizationError) return authorizationError;
  } catch {
    return jsonResponse({ error: "Unable to authorize this request." }, 500);
  }

  const parsedQuery = parseListQuery(request);
  if (!parsedQuery.ok) {
    return jsonResponse({ error: "Invalid message filters." }, 400);
  }

  try {
    const [total, newCount] = await Promise.all([
      dependencies.countMessages(parsedQuery.status),
      dependencies.countNewMessages(),
    ]);
    const pageCount = Math.max(1, Math.ceil(total / ADMIN_MESSAGES_PAGE_SIZE));
    const page = Math.min(parsedQuery.requestedPage, pageCount);
    const messages = total > 0
      ? await dependencies.findMessages({
          status: parsedQuery.status,
          skip: (page - 1) * ADMIN_MESSAGES_PAGE_SIZE,
          take: ADMIN_MESSAGES_PAGE_SIZE,
        })
      : [];

    return jsonResponse({
      messages,
      total,
      newCount,
      page,
      pageCount,
      pageSize: ADMIN_MESSAGES_PAGE_SIZE,
      status: parsedQuery.status ?? "ALL",
    }, 200);
  } catch {
    return jsonResponse({ error: "Unable to load messages." }, 500);
  }
}

function parseMessageAction(value: unknown):
  | { kind: "invalid-shape" }
  | { kind: "invalid-status" }
  | { kind: "valid"; action: AdminMessageAction } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "invalid-shape" };
  }

  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 1 || (keys[0] !== "action" && keys[0] !== "status")) {
    return { kind: "invalid-shape" };
  }

  if (keys[0] === "action") {
    return body.action === "open"
      ? { kind: "valid", action: { kind: "open" } }
      : { kind: "invalid-shape" };
  }

  if (!isAdminMessageStatus(body.status)) return { kind: "invalid-status" };
  return { kind: "valid", action: { kind: "status", status: body.status } };
}

function sameDate(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

export function resolveContactMessageTransition(
  current: ContactMessageState,
  action: AdminMessageAction,
  now: Date,
): ContactMessageTransition {
  let status = current.status;
  let readAt = current.readAt;

  if (action.kind === "open") {
    if (current.status === "NEW") {
      status = "READ";
      readAt ??= now;
    }
  } else {
    status = action.status;
    if (action.status === "READ") readAt ??= now;
    if (action.status === "NEW") readAt = null;
  }

  return {
    status,
    readAt,
    changed: status !== current.status || !sameDate(readAt, current.readAt),
  };
}

export async function handleAdminMessagePatch(
  request: Request,
  id: string,
  dependencies: AdminMessagePatchDependencies,
): Promise<Response> {
  try {
    const authorizationError = await dependencies.authorize(request);
    if (authorizationError) return authorizationError;
  } catch {
    return jsonResponse({ error: "Unable to authorize this request." }, 500);
  }

  if (!ADMIN_MESSAGE_ID_PATTERN.test(id)) {
    return jsonResponse({ error: "Message not found." }, 404);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request, ADMIN_MESSAGE_REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? jsonResponse({ error: "Request body is too large." }, 413)
      : jsonResponse({ error: "Invalid request." }, 400);
  }

  const parsedAction = parseMessageAction(body);
  if (parsedAction.kind === "invalid-shape") {
    return jsonResponse({ error: "Invalid message action." }, 400);
  }
  if (parsedAction.kind === "invalid-status") {
    return jsonResponse({ error: "Invalid message status." }, 422);
  }

  try {
    const message = await dependencies.performAction(
      id,
      parsedAction.action,
      dependencies.now?.() ?? new Date(),
    );
    if (!message) return jsonResponse({ error: "Message not found." }, 404);
    return jsonResponse({ message }, 200);
  } catch {
    return jsonResponse({ error: "Unable to update the message." }, 500);
  }
}
