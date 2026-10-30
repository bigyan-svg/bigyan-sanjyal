export const ADMIN_SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS = 60 * 1000;

export function isAdminSessionCurrentAt(
  expiresAt: Date,
  lastSeenAt: Date,
  now = Date.now(),
): boolean {
  const expiresAtTimestamp = expiresAt.getTime();
  const lastSeenAtTimestamp = lastSeenAt.getTime();

  return (
    Number.isFinite(expiresAtTimestamp) &&
    Number.isFinite(lastSeenAtTimestamp) &&
    expiresAtTimestamp > now &&
    lastSeenAtTimestamp > now - ADMIN_SESSION_IDLE_TIMEOUT_MS
  );
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
