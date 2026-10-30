import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SESSION_ACTIVITY_UPDATE_INTERVAL_MS,
  ADMIN_SESSION_IDLE_TIMEOUT_MS,
  isAdminSessionCurrentAt,
  shouldUpdateAdminSessionActivity,
} from "../src/lib/auth/session-policy";
import { getAdminSessionCookieOptions } from "../src/lib/auth/session-cookie-options";
import {
  revokeAdminSession,
  type AdminSessionRevocationStore,
} from "../src/lib/auth/session-revocation";

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
    isAdminSessionCurrentAt(
      new Date(now),
      new Date(now - 1000),
      now,
    ),
    false,
  );
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
