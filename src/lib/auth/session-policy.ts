export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS = 60 * 1000;

export function isAdminSessionRevoked(revokedAt: Date | null): boolean {
  return revokedAt !== null;
}

export function getAdminSessionLifetimeRejection(
  expiresAt: Date,
  lastSeenAt: Date,
  now = Date.now(),
): "absolute-expiry" | "idle-timeout" | null {
  const expiresAtTimestamp = expiresAt.getTime();
  const lastSeenAtTimestamp = lastSeenAt.getTime();

  if (!Number.isFinite(expiresAtTimestamp) || expiresAtTimestamp <= now) {
    return "absolute-expiry";
  }

  if (
    !Number.isFinite(lastSeenAtTimestamp) ||
    lastSeenAtTimestamp <= now - ADMIN_SESSION_IDLE_TIMEOUT_MS
  ) {
    return "idle-timeout";
  }

  return null;
}

export function isAdminSessionCurrentAt(
  expiresAt: Date,
  lastSeenAt: Date,
  now = Date.now(),
): boolean {
  return getAdminSessionLifetimeRejection(expiresAt, lastSeenAt, now) === null;
}

export function shouldUpdateAdminSessionActivity(
  lastSeenAt: Date,
  now = Date.now(),
): boolean {
  const lastSeenAtTimestamp = lastSeenAt.getTime();

  return (
    Number.isFinite(lastSeenAtTimestamp) &&
    now - lastSeenAtTimestamp >= ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS
  );
}
