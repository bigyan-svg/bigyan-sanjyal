import "server-only";

import { cookies } from "next/headers";
import { clearAdminSessionCookie } from "@/lib/auth/cookies";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { revokeAdminSession } from "@/lib/auth/session-revocation";
import { validateAdminSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { logAdminAuthDiagnostic } from "@/lib/auth/auth-diagnostics";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

function jsonResponse(
  body: { success: true } | { error: string },
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedRequestOrigin(request)) {
    return jsonResponse({ error: "Unable to complete logout." }, 403);
  }

  let failed = false;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;

    if (token) {
      const session = await validateAdminSession(token, "logout");

      if (session) {
        const revokedCount = await revokeAdminSession(session.sessionId, {
          updateMany: (args) => prisma.adminSession.updateMany(args),
        });
        logAdminAuthDiagnostic({
          boundary: "logout",
          outcome: revokedCount === 1 ? "revoked" : "rejected",
          phase: "logout-revocation",
          reason: revokedCount === 1 ? undefined : "session-revoked",
        });
      } else {
        logAdminAuthDiagnostic({
          boundary: "logout",
          outcome: "rejected",
          phase: "logout-revocation",
          reason: "session-not-found",
        });
      }
    } else {
      logAdminAuthDiagnostic({
        boundary: "logout",
        outcome: "rejected",
        phase: "logout-revocation",
        reason: "missing-cookie",
      });
    }
  } catch {
    failed = true;
  }

  try {
    await clearAdminSessionCookie();
    logAdminAuthDiagnostic({
      boundary: "logout",
      outcome: "cleared",
      phase: "logout-revocation",
      cookieName: ADMIN_SESSION_COOKIE_NAME,
    });
  } catch {
    failed = true;
  }

  if (failed) {
    return jsonResponse({ error: "Unable to complete logout." }, 500);
  }

  return jsonResponse({ success: true }, 200);
}
