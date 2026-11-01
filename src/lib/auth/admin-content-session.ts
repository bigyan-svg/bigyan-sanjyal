export interface AdminContentSession {
  user: { role: string };
}

export type AdminContentSessionValidator = (
  token: string,
) => Promise<AdminContentSession | null>;

export function adminContentResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function getAdminSessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  let token: string | undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "admin_session") continue;

    // Reject duplicate session-cookie names so the request cannot supply an
    // ambiguous session value that different cookie parsers might interpret differently.
    if (token !== undefined) return undefined;
    token = part.slice(separator + 1).trim();
  }

  return token || undefined;
}

export async function authorizeAdminContentSessionToken(
  token: string | undefined,
  validateSession: AdminContentSessionValidator,
): Promise<Response | null> {
  if (!token) {
    return adminContentResponse({ error: "Authentication is required." }, 401);
  }

  try {
    const session = await validateSession(token);
    if (!session) {
      return adminContentResponse({ error: "Authentication is required." }, 401);
    }

    if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
      return adminContentResponse(
        { error: "You are not authorized to manage site content." },
        403,
      );
    }

    return null;
  } catch {
    return adminContentResponse({ error: "Unable to authorize this request." }, 500);
  }
}

export function authorizeAdminContentReadRequest(
  request: Request,
  validateSession: AdminContentSessionValidator,
): Promise<Response | null> {
  return authorizeAdminContentSessionToken(getAdminSessionToken(request), validateSession);
}
