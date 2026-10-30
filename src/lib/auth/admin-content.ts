import "server-only";

import { cookies } from "next/headers";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { validateAdminSession } from "@/lib/auth/session";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export function adminContentResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function authorizeAdminContentWrite(
  request: Request,
  requireJson = true,
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

  try {
    const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateAdminSession(token) : null;

    if (!session) {
      return adminContentResponse({ error: "Authentication is required." }, 401);
    }

    if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
      return adminContentResponse({ error: "You are not authorized to manage skills." }, 403);
    }

    return null;
  } catch {
    return adminContentResponse({ error: "Unable to authorize this request." }, 500);
  }
}
