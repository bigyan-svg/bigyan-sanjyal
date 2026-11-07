import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isAdminSettingsRole } from "../src/lib/admin-settings-access";
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  createPasswordChangePayload,
  createPasswordChangeSubmissionGuard,
  passwordChangeFailureMessage,
  requestPasswordChange,
  validatePasswordChangeForm,
  type PasswordChangeFormValues,
} from "../src/lib/admin-settings-password";

function validValues(overrides: Partial<PasswordChangeFormValues> = {}): PasswordChangeFormValues {
  return {
    currentPassword: "current-secret",
    newPassword: "a-new-password-12",
    confirmNewPassword: "a-new-password-12",
    ...overrides,
  };
}

test("settings access is limited to ADMIN and EDITOR roles", () => {
  assert.equal(isAdminSettingsRole("ADMIN"), true);
  assert.equal(isAdminSettingsRole("EDITOR"), true);
  assert.equal(isAdminSettingsRole("VIEWER"), false);
  assert.equal(isAdminSettingsRole(null), false);
});

test("password form validates required values, server length rules, and confirmation", () => {
  assert.deepEqual(validatePasswordChangeForm(validValues({
    currentPassword: "",
    newPassword: "short",
    confirmNewPassword: "different",
  })), {
    currentPassword: "Enter your current password.",
    newPassword: `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`,
    confirmNewPassword: "The passwords do not match.",
  });
  assert.deepEqual(validatePasswordChangeForm(validValues({
    newPassword: "a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1),
    confirmNewPassword: "a".repeat(ADMIN_PASSWORD_MAX_LENGTH + 1),
  })), {
    newPassword: "The new password is too long.",
    confirmNewPassword: "The confirmation is too long.",
  });
  assert.deepEqual(validatePasswordChangeForm(validValues({
    newPassword: "current-secret",
    confirmNewPassword: "current-secret",
  })), {
    newPassword: "Choose a password different from your current password.",
  });
});

test("password form counts Unicode code points like the server and accepts the exact minimum", () => {
  const minimum = "🔐".repeat(ADMIN_PASSWORD_MIN_LENGTH);
  assert.deepEqual(validatePasswordChangeForm(validValues({
    newPassword: minimum,
    confirmNewPassword: minimum,
  })), {});
  assert.equal(validatePasswordChangeForm(validValues({
    newPassword: "🔐".repeat(ADMIN_PASSWORD_MIN_LENGTH - 1),
    confirmNewPassword: "🔐".repeat(ADMIN_PASSWORD_MIN_LENGTH - 1),
  })).newPassword, `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`);
});

test("request payload contains only the three documented password fields", () => {
  const payload = createPasswordChangePayload({
    ...validValues(),
    ignored: "not sent",
  } as PasswordChangeFormValues & { ignored: string });
  assert.deepEqual(Object.keys(payload).sort(), [
    "confirmNewPassword",
    "currentPassword",
    "newPassword",
  ]);
});

test("successful API responses preserve cookie-clear state without exposing server details", async () => {
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;
  const clearedResult = await requestPasswordChange(validValues(), async (input, init) => {
    requestedUrl = String(input);
    requestInit = init;
    return Response.json({ success: true, sessionCookieCleared: true });
  });

  assert.deepEqual(clearedResult, { ok: true, sessionCookieCleared: true });

  const unclearedResult = await requestPasswordChange(validValues(), async () =>
    Response.json({ success: true, sessionCookieCleared: false }),
  );
  assert.deepEqual(unclearedResult, { ok: true, sessionCookieCleared: false });
  assert.equal(requestedUrl, "/api/auth/change-password");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.credentials, "same-origin");
  assert.equal(requestInit?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), validValues());
});

test("does not accept malformed success responses or surface server response bodies", async () => {
  const malformed = await requestPasswordChange(validValues(), async () =>
    Response.json({ success: "true", error: "internal detail" }),
  );
  assert.deepEqual(malformed, { ok: false, reason: "unexpected" });

  const missingCookieState = await requestPasswordChange(validValues(), async () =>
    Response.json({ success: true }),
  );
  assert.deepEqual(missingCookieState, { ok: false, reason: "unexpected" });

  const invalidCookieState = await requestPasswordChange(validValues(), async () =>
    Response.json({ success: true, sessionCookieCleared: "false" }),
  );
  assert.deepEqual(invalidCookieState, { ok: false, reason: "unexpected" });

  const serverFailure = await requestPasswordChange(validValues(), async () =>
    Response.json({ error: "private server detail" }, { status: 500 }),
  );
  assert.deepEqual(serverFailure, { ok: false, reason: "unexpected" });
});

test("maps expired session, rate limiting, service failure, and network errors safely", async () => {
  for (const [status, reason] of [
    [401, "unauthorized"],
    [429, "rate-limited"],
    [503, "unavailable"],
  ] as const) {
    const result = await requestPasswordChange(validValues(), async () =>
      Response.json({ error: "not shown" }, { status }),
    );
    assert.deepEqual(result, { ok: false, reason });
    assert.ok(!passwordChangeFailureMessage(reason).includes("not shown"));
  }

  const network = await requestPasswordChange(validValues(), async () => {
    throw new Error("network detail");
  });
  assert.deepEqual(network, { ok: false, reason: "network" });
  assert.equal(passwordChangeFailureMessage("network").includes("network detail"), false);
});

test("duplicate password-change submissions are suppressed while one is pending", async () => {
  const guard = createPasswordChangeSubmissionGuard();
  let release: (() => void) | undefined;
  let calls = 0;
  const pending = guard.run(async () => {
    calls += 1;
    await new Promise<void>((resolve) => { release = resolve; });
  });

  const duplicate = await guard.run(async () => {
    calls += 1;
  });
  assert.deepEqual(duplicate, { started: false });
  assert.equal(calls, 1);

  release?.();
  assert.deepEqual(await pending, { started: true, value: undefined });
  assert.equal(calls, 1);
});

test("password form does not persist credentials or log them", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/app/admin/settings/settings-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/admin-settings-password.ts", import.meta.url), "utf8"),
  ]);
  const source = sources.join("\n");

  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b/u);
  assert.doesNotMatch(source, /\bdocument\.cookie\b/u);
  assert.doesNotMatch(source, /\bconsole\.(?:log|info|warn|error)\s*\(/u);
});
