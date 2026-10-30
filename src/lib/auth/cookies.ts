import "server-only";

import { cookies } from "next/headers";
import { getAdminSessionCookieOptions } from "./session-cookie-options";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export async function setAdminSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, token, {
    ...getAdminSessionCookieOptions(process.env.NODE_ENV === "production"),
  });
}

export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);
}
