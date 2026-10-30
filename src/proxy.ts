import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const ADMIN_LOGIN_PATH = "/admin/login";

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname.replace(/\/+$/u, "") || "/";

  if (pathname === ADMIN_LOGIN_PATH) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE_NAME);

  if (sessionCookie?.value) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = ADMIN_LOGIN_PATH;
  loginUrl.search = "";

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
