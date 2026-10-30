import "server-only";

import { cookies } from "next/headers";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export async function setAdminSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  if (Number.isNaN(expiresAt.getTime())) {
    throw new RangeError("Session cookie expiration must be a valid date.");
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearAdminSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);
}
