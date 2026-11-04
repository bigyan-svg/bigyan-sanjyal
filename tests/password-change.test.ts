import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handlePasswordChange,
  type PasswordChangeDependencies,
} from "../src/lib/auth/password-change";
import {
  PasswordChangeSessionStateChangedError,
  PasswordRecoveryAccountStateChangedError,
  recoverAdminPasswordAndRevokeSessions,
  updatePasswordAndRevokeSessions,
  type PasswordChangeExecuteRaw,
} from "../src/lib/auth/password-change-transaction";
import { getPasswordRecoveryValidationFailure } from "../src/lib/auth/password-recovery-validation";

const TRUSTED_ORIGIN = "https://example.test";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    currentPassword: "current-password",
    newPassword: "a-new-password-longer-than-twelve",
    confirmNewPassword: "a-new-password-longer-than-twelve",
    ...overrides,
  };
}

function makeRequest(
  body: unknown,
  options: {
    origin?: string;
    contentType?: string;
    rawBody?: string;
    contentLength?: string | null;
  } = {},
): Request {
  const headers = new Headers({
    Origin: options.origin ?? TRUSTED_ORIGIN,
    "Content-Type": options.contentType ?? "application/json; charset=utf-8",
  });
  const serializedBody = options.rawBody ?? JSON.stringify(body);
  if (options.contentLength !== null) {
    headers.set(
      "Content-Length",
      options.contentLength ?? String(Buffer.byteLength(serializedBody, "utf8")),
    );
  }

  return new Request("https://example.test/api/auth/change-password", {
    method: "POST",
    headers,
    body: serializedBody,
  });
}

function createFixture(overrides: Partial<PasswordChangeDependencies> = {}) {
  const calls = {
    validateSession: 0,
    rateLimit: 0,
    findAdminUser: 0,
    verifyPassword: [] as Array<[string, string]>,
    hashPassword: [] as string[],
    updatePasswordAndRevokeSessions: [] as Array<[string, string, string, string]>,
    clearSessionCookie: 0,
  };

  const dependencies: PasswordChangeDependencies = {
    isTrustedOrigin: (request) => request.headers.get("origin") === TRUSTED_ORIGIN,
    getSessionToken: async () => "mock-session",
    validateSession: async () => {
      calls.validateSession += 1;
      return { sessionId: "mock-session-id", user: { id: "mock-user-id" } };
    },
    checkRateLimit: async () => {
      calls.rateLimit += 1;
      return { status: "allowed" };
    },
    findAdminUser: async () => {
      calls.findAdminUser += 1;
      return {
        id: "mock-user-id",
        passwordHash: "stored-password-hash",
        isActive: true,
      };
    },
    verifyPassword: async (password, passwordHash) => {
      calls.verifyPassword.push([password, passwordHash]);
      return true;
    },
    hashPassword: async (password) => {
      calls.hashPassword.push(password);
      return "new-password-hash";
    },
    updatePasswordAndRevokeSessions: async (...args) => {
      calls.updatePasswordAndRevokeSessions.push(args);
    },
    clearSessionCookie: async () => {
      calls.clearSessionCookie += 1;
    },
    ...overrides,
  };

  return { calls, dependencies };
}

async function assertNoStore(response: Response): Promise<void> {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("changes a password through the existing verification and revocation flow", async () => {
  const { calls, dependencies } = createFixture();
  const response = await handlePasswordChange(makeRequest(validBody()), dependencies);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(calls.verifyPassword, [["current-password", "stored-password-hash"]]);
  assert.deepEqual(calls.hashPassword, ["a-new-password-longer-than-twelve"]);
  assert.deepEqual(calls.updatePasswordAndRevokeSessions, [[
    "mock-user-id",
    "mock-session-id",
    "stored-password-hash",
    "new-password-hash",
  ]]);
  assert.equal(calls.clearSessionCookie, 1);
  await assertNoStore(response);
});

test("rejects missing, empty, and incorrectly typed password fields", async () => {
  const invalidBodies = [
    { newPassword: "a-new-password-longer-than-twelve", confirmNewPassword: "a-new-password-longer-than-twelve" },
    { currentPassword: "current-password" },
    validBody({ currentPassword: "" }),
    validBody({ newPassword: 42 }),
  ];

  for (const body of invalidBodies) {
    const { calls, dependencies } = createFixture();
    const response = await handlePasswordChange(makeRequest(body), dependencies);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid request." });
    assert.equal(calls.findAdminUser, 0);
    await assertNoStore(response);
  }
});

test("rejects an incorrect current password with a generic response", async () => {
  const { calls, dependencies } = createFixture({
    verifyPassword: async () => false,
  });
  const response = await handlePasswordChange(makeRequest(validBody()), dependencies);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unable to change password." });
  assert.equal(calls.hashPassword.length, 0);
  assert.equal(calls.updatePasswordAndRevokeSessions.length, 0);
  await assertNoStore(response);
});

test("rejects weak, mismatched, unchanged, and oversized password values", async () => {
  const invalidBodies = [
    validBody({ newPassword: "short", confirmNewPassword: "short" }),
    validBody({ newPassword: "", confirmNewPassword: "" }),
    validBody({ confirmNewPassword: "a-different-password" }),
    validBody({ newPassword: "current-password", confirmNewPassword: "current-password" }),
    validBody({ currentPassword: "c".repeat(1_025) }),
    validBody({ newPassword: "n".repeat(1_025), confirmNewPassword: "n".repeat(1_025) }),
  ];

  for (const body of invalidBodies) {
    const { calls, dependencies } = createFixture();
    const response = await handlePasswordChange(makeRequest(body), dependencies);

    assert.ok(response.status === 400 || response.status === 401);
    assert.equal(calls.updatePasswordAndRevokeSessions.length, 0);
    await assertNoStore(response);
  }
});

test("rejects unknown request properties", async () => {
  const { calls, dependencies } = createFixture();
  const response = await handlePasswordChange(
    makeRequest(validBody({ isAdmin: true })),
    dependencies,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid request." });
  assert.equal(calls.findAdminUser, 0);
  await assertNoStore(response);
});

test("rejects invalid JSON and oversized bodies without processing them", async () => {
  const invalidFixture = createFixture();
  const invalidJsonResponse = await handlePasswordChange(
    makeRequest(null, { rawBody: "{" }),
    invalidFixture.dependencies,
  );

  assert.equal(invalidJsonResponse.status, 400);
  await assertNoStore(invalidJsonResponse);

  const oversizedFixture = createFixture();
  const oversizedResponse = await handlePasswordChange(
    makeRequest(validBody(), { contentLength: String(16 * 1024 + 1) }),
    oversizedFixture.dependencies,
  );

  assert.equal(oversizedResponse.status, 413);
  assert.deepEqual(await oversizedResponse.json(), { error: "Request body is too large." });
  assert.equal(oversizedFixture.calls.findAdminUser, 0);
  await assertNoStore(oversizedResponse);

  const streamingFixture = createFixture();
  const oversizedRawBody = JSON.stringify({ payload: "x".repeat(16 * 1024) });
  const streamingResponse = await handlePasswordChange(
    makeRequest(null, { rawBody: oversizedRawBody, contentLength: null }),
    streamingFixture.dependencies,
  );

  assert.equal(streamingResponse.status, 413);
  assert.equal(streamingFixture.calls.findAdminUser, 0);
  await assertNoStore(streamingResponse);
});

test("rejects missing or invalid sessions", async () => {
  for (const overrides of [
    { getSessionToken: async () => undefined },
    { validateSession: async () => null },
  ]) {
    const { calls, dependencies } = createFixture(overrides);
    const response = await handlePasswordChange(makeRequest(validBody()), dependencies);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unable to change password." });
    assert.equal(calls.rateLimit, 0);
    assert.equal(calls.findAdminUser, 0);
    await assertNoStore(response);
  }
});

test("rejects disallowed Origin and incorrect content type before session access", async () => {
  const originFixture = createFixture();
  const originResponse = await handlePasswordChange(
    makeRequest(validBody(), { origin: "https://attacker.example" }),
    originFixture.dependencies,
  );

  assert.equal(originResponse.status, 403);
  assert.equal(originFixture.calls.validateSession, 0);
  await assertNoStore(originResponse);

  const contentTypeFixture = createFixture();
  const contentTypeResponse = await handlePasswordChange(
    makeRequest(validBody(), { contentType: "text/plain" }),
    contentTypeFixture.dependencies,
  );

  assert.equal(contentTypeResponse.status, 415);
  assert.equal(contentTypeFixture.calls.validateSession, 0);
  await assertNoStore(contentTypeResponse);
});

test("rejects rate-limited requests and fails closed when the limiter is unavailable", async () => {
  const limitedFixture = createFixture({
    checkRateLimit: async () => ({ status: "limited", retryAfterSeconds: 30 }),
  });
  const limitedResponse = await handlePasswordChange(
    makeRequest(validBody()),
    limitedFixture.dependencies,
  );

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "30");
  assert.deepEqual(await limitedResponse.json(), {
    error: "Too many password-change attempts. Please try again later.",
  });
  assert.equal(limitedFixture.calls.findAdminUser, 0);
  await assertNoStore(limitedResponse);

  const unavailableFixture = createFixture({
    checkRateLimit: async () => ({ status: "unavailable" }),
  });
  const unavailableResponse = await handlePasswordChange(
    makeRequest(validBody()),
    unavailableFixture.dependencies,
  );

  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    error: "Unable to change password.",
  });
  assert.equal(unavailableFixture.calls.findAdminUser, 0);
  await assertNoStore(unavailableResponse);

  const thrownFixture = createFixture({
    checkRateLimit: async () => {
      throw new Error("private rate-limit details");
    },
  });
  const thrownResponse = await handlePasswordChange(
    makeRequest(validBody()),
    thrownFixture.dependencies,
  );

  assert.equal(thrownResponse.status, 500);
  assert.deepEqual(await thrownResponse.json(), {
    error: "Unable to change password.",
  });
  assert.equal(thrownFixture.calls.findAdminUser, 0);
  await assertNoStore(thrownResponse);
});

test("a successful password update revokes active sessions in the same transaction", async () => {
  const executedQueries: Array<{ sql: string; values: unknown[] }> = [];
  const executeRaw: PasswordChangeExecuteRaw = async (query, ...values) => {
    executedQueries.push({ sql: Array.from(query).join(" ? "), values });
    return executedQueries.length === 1 ? 1 : 3;
  };

  await updatePasswordAndRevokeSessions(executeRaw, {
    userId: "mock-user-id",
    sessionId: "mock-session-id",
    currentPasswordHash: "old-hash",
    newPasswordHash: "new-hash",
  });

  assert.equal(executedQueries.length, 2);
  assert.match(executedQueries[0].sql, /UPDATE "AdminUser"/u);
  assert.match(executedQueries[1].sql, /UPDATE "AdminSession"/u);
  assert.match(executedQueries[1].sql, /"revokedAt" IS NULL/u);
  assert.deepEqual(executedQueries[1].values, ["mock-user-id"]);
});

test("does not revoke sessions if the guarded password update found no current session", async () => {
  let queryCount = 0;
  const executeRaw: PasswordChangeExecuteRaw = async () => {
    queryCount += 1;
    return 0;
  };

  await assert.rejects(
    updatePasswordAndRevokeSessions(executeRaw, {
      userId: "mock-user-id",
      sessionId: "mock-session-id",
      currentPasswordHash: "old-hash",
      newPasswordHash: "new-hash",
    }),
    PasswordChangeSessionStateChangedError,
  );
  assert.equal(queryCount, 1);
});

test("recovery updates only an existing active ADMIN and revokes all active sessions atomically", async () => {
  const executedQueries: Array<{ sql: string; values: unknown[] }> = [];
  const executeRaw: PasswordChangeExecuteRaw = async (query, ...values) => {
    executedQueries.push({ sql: Array.from(query).join(" ? "), values });
    return executedQueries.length === 1 ? 1 : 2;
  };

  await recoverAdminPasswordAndRevokeSessions(executeRaw, {
    userId: "existing-admin-id",
    newPasswordHash: "new-argon2id-hash",
  });

  assert.equal(executedQueries.length, 2);
  assert.match(executedQueries[0].sql, /UPDATE "AdminUser"/u);
  assert.match(executedQueries[0].sql, /"role" = 'ADMIN'/u);
  assert.match(executedQueries[0].sql, /"isActive" = TRUE/u);
  assert.match(executedQueries[0].sql, /clock_timestamp\(\)/u);
  assert.deepEqual(executedQueries[0].values, ["new-argon2id-hash", "existing-admin-id"]);
  assert.match(executedQueries[1].sql, /UPDATE "AdminSession"/u);
  assert.match(executedQueries[1].sql, /"revokedAt" IS NULL/u);
  assert.deepEqual(executedQueries[1].values, ["existing-admin-id"]);
});

test("recovery does not revoke sessions when the existing ADMIN is no longer eligible", async () => {
  let queryCount = 0;
  const executeRaw: PasswordChangeExecuteRaw = async () => {
    queryCount += 1;
    return 0;
  };

  await assert.rejects(
    recoverAdminPasswordAndRevokeSessions(executeRaw, {
      userId: "existing-admin-id",
      newPasswordHash: "new-argon2id-hash",
    }),
    PasswordRecoveryAccountStateChangedError,
  );
  assert.equal(queryCount, 1);
});

test("password recovery enforces the normal minimum, maximum, and confirmation policy", () => {
  assert.equal(getPasswordRecoveryValidationFailure("a".repeat(12), "a".repeat(12)), null);
  assert.equal(getPasswordRecoveryValidationFailure("🙂".repeat(12), "🙂".repeat(12)), null);
  assert.equal(getPasswordRecoveryValidationFailure("short", "short"), "too-short");
  assert.equal(
    getPasswordRecoveryValidationFailure("a".repeat(1_025), "a".repeat(1_025)),
    "too-long",
  );
  assert.equal(getPasswordRecoveryValidationFailure("a".repeat(12), "b".repeat(12)), "mismatch");
});

test("returns safe no-store errors for session races and database failures", async () => {
  const raceFixture = createFixture({
    updatePasswordAndRevokeSessions: async () => {
      throw new PasswordChangeSessionStateChangedError();
    },
  });
  const raceResponse = await handlePasswordChange(
    makeRequest(validBody()),
    raceFixture.dependencies,
  );

  assert.equal(raceResponse.status, 401);
  assert.deepEqual(await raceResponse.json(), { error: "Unable to change password." });
  assert.equal(raceFixture.calls.clearSessionCookie, 0);
  await assertNoStore(raceResponse);

  const failureFixture = createFixture({
    updatePasswordAndRevokeSessions: async () => {
      throw new Error("private database details");
    },
  });
  const failureResponse = await handlePasswordChange(
    makeRequest(validBody()),
    failureFixture.dependencies,
  );
  const failureBody = await failureResponse.text();

  assert.equal(failureResponse.status, 500);
  assert.equal(failureBody, JSON.stringify({ error: "Unable to change password." }));
  assert.equal(failureBody.includes("private database details"), false);
  await assertNoStore(failureResponse);
});
