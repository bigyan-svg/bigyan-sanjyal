import "server-only";

import { cookies } from "next/headers";
import { clearAdminSessionCookie } from "@/lib/auth/cookies";
import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { validateAdminSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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
      const session = await validateAdminSession(token);

      if (session) {
        await prisma.adminSession.updateMany({
          where: {
            id: session.sessionId,
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        });
      }
    }
  } catch {
    failed = true;
  }

  try {
    await clearAdminSessionCookie();
  } catch {
    failed = true;
  }

  if (failed) {
    return jsonResponse({ error: "Unable to complete logout." }, 500);
  }

  return jsonResponse({ success: true }, 200);
}
