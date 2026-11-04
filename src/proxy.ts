import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getStrictTransportSecurityHeader } from "./lib/security-headers";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const ADMIN_LOGIN_PATH = "/admin/login";

export function proxy(request: NextRequest): NextResponse {
  const addTransportSecurityHeader = (response: NextResponse): NextResponse => {
    const hsts = getStrictTransportSecurityHeader(
      process.env.NODE_ENV,
      request.nextUrl.protocol,
    );
    if (hsts) response.headers.set("Strict-Transport-Security", hsts);
    return response;
  };

  const pathname = request.nextUrl.pathname.replace(/\/+$/u, "") || "/";

  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) {
    return addTransportSecurityHeader(NextResponse.next());
  }

  if (pathname === ADMIN_LOGIN_PATH) {
    return addTransportSecurityHeader(NextResponse.next());
  }

  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE_NAME);

  if (sessionCookie?.value) {
    return addTransportSecurityHeader(NextResponse.next());
  }

  if (process.env.NODE_ENV === "development") {
    console.info(
      "[admin-auth-diagnostic]",
      JSON.stringify({
        environment: "development",
        boundary: "proxy",
        outcome: "rejected",
        reason: "missing-cookie",
      }),
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = ADMIN_LOGIN_PATH;
  loginUrl.search = "";

  return addTransportSecurityHeader(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
