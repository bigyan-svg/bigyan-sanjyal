import "server-only";

import { cookies } from "next/headers";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { validateAdminSession } from "@/lib/auth/session";
import {
  adminContentResponse,
  authorizeAdminOnlyContentReadRequest,
  authorizeAdminOnlySessionToken,
  authorizeAdminContentReadRequest,
  authorizeAdminContentSessionToken,
} from "./admin-content-session";

export { adminContentResponse } from "./admin-content-session";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

async function authorizeAdminContentCookieSession(): Promise<Response | null> {
  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
    return authorizeAdminContentSessionToken(token, validateAdminSession);
  } catch {
    return adminContentResponse({ error: "Unable to authorize this request." }, 500);
  }
}

async function authorizeAdminOnlyContentCookieSession(): Promise<Response | null> {
  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
    return authorizeAdminOnlySessionToken(token, validateAdminSession);
  } catch {
    return adminContentResponse({ error: "Unable to authorize this request." }, 500);
  }
}

export function authorizeAdminContentRead(request: Request): Promise<Response | null> {
  return authorizeAdminContentReadRequest(request, validateAdminSession);
}

export function authorizeAdminOnlyContentRead(request: Request): Promise<Response | null> {
  return authorizeAdminOnlyContentReadRequest(request, validateAdminSession);
}

export async function authorizeAdminContentWrite(
  request: Request,
  requireJson = true,
): Promise<Response | null> {
  return authorizeContentWrite(request, requireJson, authorizeAdminContentCookieSession);
}

export async function authorizeAdminOnlyContentWrite(
  request: Request,
  requireJson = true,
): Promise<Response | null> {
  return authorizeContentWrite(request, requireJson, authorizeAdminOnlyContentCookieSession);
}

async function authorizeContentWrite(
  request: Request,
  requireJson: boolean,
  authorizeCookieSession: () => Promise<Response | null>,
): Promise<Response | null> {
  if (!hasTrustedRequestOrigin(request)) {
    return adminContentResponse({ error: "Invalid request." }, 403);
  }

  if (
    requireJson &&
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
  ) {
    return adminContentResponse({ error: "Content-Type must be application/json." }, 415);
  }

  return authorizeCookieSession();
}
