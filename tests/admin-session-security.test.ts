import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  getAdminSessionLifetimeRejection,
  isAdminSessionRevoked,
  isAdminSessionCurrentAt,
  shouldUpdateAdminSessionActivity,
} from "../src/lib/auth/session-policy";
import { compareSessionPasswordChangeTimestamps } from "../src/lib/auth/session-password-change";
import { getAdminSessionCookieOptions } from "../src/lib/auth/session-cookie-options";
import {
  revokeAdminSession,
  type AdminSessionRevocationStore,
} from "../src/lib/auth/session-revocation";
import {
  generateSessionToken,
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "../src/lib/auth/session-token";

const now = Date.parse("2026-01-01T12:00:00.000Z");

test("an active session remains valid before its idle timeout", () => {
  assert.equal(
    isAdminSessionCurrentAt(
      new Date(now + 60 * 60 * 1000),
      new Date(now - ADMIN_SESSION_IDLE_TIMEOUT_MS + 1000),
      now,
    ),
    true,
  );
});

test("an idle session expires at 15 minutes", () => {
  assert.equal(
    isAdminSessionCurrentAt(
      new Date(now + 60 * 60 * 1000),
      new Date(now - ADMIN_SESSION_IDLE_TIMEOUT_MS),
      now,
    ),
    false,
  );
});

test("an absolutely expired session remains invalid even with recent activity", () => {
  assert.equal(
    getAdminSessionLifetimeRejection(
      new Date(now),
      new Date(now - 1000),
      now,
    ),
    "absolute-expiry",
  );
  assert.equal(
    isAdminSessionCurrentAt(
      new Date(now),
      new Date(now - 1000),
      now,
    ),
    false,
  );
});

test("sessions created before a password change are rejected at microsecond precision", () => {
  const comparison = compareSessionPasswordChangeTimestamps(
    "1796124399999999",
    "1796124400000000",
    "2026-12-01T11:26:39.999999Z",
    "2026-12-01T11:26:40.000000Z",
  );

  assert.ok(comparison);
  assert.equal(comparison.isNewer, false);
  assert.equal(comparison.isEqual, false);
});

test("previously issued sessions fail both revocation and password-change checks", () => {
  const sessions = [
    { id: "browser-one", createdAt: "1796124399999999", revokedAt: new Date(now) },
    { id: "browser-two", createdAt: "1796124399999998", revokedAt: new Date(now) },
  ];

  for (const session of sessions) {
    assert.equal(isAdminSessionRevoked(session.revokedAt), true);

    const comparison = compareSessionPasswordChangeTimestamps(
      session.createdAt,
      "1796124400000000",
      "2026-12-01T11:26:39.999999Z",
      "2026-12-01T11:26:40.000000Z",
    );
    assert.ok(comparison);
    assert.equal(comparison.isNewer, false);
  }
});

test("sessions created after a password change are accepted at microsecond precision", () => {
  const comparison = compareSessionPasswordChangeTimestamps(
    "1796124400000001",
    "1796124400000000",
    "2026-12-01T11:26:40.000001Z",
    "2026-12-01T11:26:40.000000Z",
  );

  assert.ok(comparison);
  assert.equal(comparison.isNewer, true);
  assert.equal(comparison.isEqual, false);
});

test("equal session and password-change timestamps are rejected deterministically", () => {
  const comparison = compareSessionPasswordChangeTimestamps(
    "1796124400000000",
    "1796124400000000",
    "2026-12-01T11:26:40.000000Z",
    "2026-12-01T11:26:40.000000Z",
  );

  assert.ok(comparison);
  assert.equal(comparison.isNewer, false);
  assert.equal(comparison.isEqual, true);
});

test("revoked sessions remain rejected", () => {
  assert.equal(isAdminSessionRevoked(new Date(now)), true);
  assert.equal(isAdminSessionRevoked(null), false);
});

test("activity writes are skipped inside the update interval", () => {
  assert.equal(
    shouldUpdateAdminSessionActivity(
      new Date(now - ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS + 1),
      now,
    ),
    false,
  );
  assert.equal(
    shouldUpdateAdminSessionActivity(
      new Date(now - ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS),
      now,
    ),
    true,
  );
});

test("session cookies have browser-session lifetime and required security flags", () => {
  const productionOptions = getAdminSessionCookieOptions(true);
  const developmentOptions = getAdminSessionCookieOptions(false);

  assert.deepEqual(productionOptions, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
  assert.equal(developmentOptions.httpOnly, true);
  assert.equal(developmentOptions.secure, false);
  assert.equal(developmentOptions.sameSite, "lax");
  assert.equal("expires" in productionOptions, false);
  assert.equal("maxAge" in productionOptions, false);
});

test("manual revocation immediately revokes only the selected active session", async () => {
  const revokedAtById = new Map<string, Date | null>([
    ["current-session", null],
    ["other-session", null],
  ]);
  const store: AdminSessionRevocationStore = {
    updateMany: async ({ where, data }) => {
      const currentRevokedAt = revokedAtById.get(where.id);

      if (currentRevokedAt === undefined || currentRevokedAt !== where.revokedAt) {
        return { count: 0 };
      }

      revokedAtById.set(where.id, data.revokedAt);
      return { count: 1 };
    },
  };
  const revokedAt = new Date(now);

  assert.equal(await revokeAdminSession("current-session", store, revokedAt), 1);
  assert.equal(await revokeAdminSession("current-session", store, revokedAt), 0);
  assert.equal(revokedAtById.get("current-session"), revokedAt);
  assert.equal(revokedAtById.get("other-session"), null);
});

test("development session tokens hash consistently and become invalid after process-key rotation", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const mutableEnvironment = process.env as unknown as Record<string, string | undefined>;
  const globalWithKey = globalThis as typeof globalThis & {
    __bigyanAdminSessionDevelopmentKey?: Uint8Array;
  };
  const previousDevelopmentKey = globalWithKey.__bigyanAdminSessionDevelopmentKey;

  try {
    mutableEnvironment.NODE_ENV = "development";
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    assert.equal(isCurrentDevelopmentSessionToken(token), true);
    assert.match(tokenHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(tokenHash, token);

    globalWithKey.__bigyanAdminSessionDevelopmentKey = new Uint8Array(32).fill(7);
    assert.equal(isCurrentDevelopmentSessionToken(token), false);
  } finally {
    globalWithKey.__bigyanAdminSessionDevelopmentKey = previousDevelopmentKey;
    if (previousNodeEnv === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousNodeEnv;
  }
});
