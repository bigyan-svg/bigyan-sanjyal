import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  authorizePreviewDiagnosticAdminRead,
  validatePreviewDiagnosticAdminSession,
  type PreviewDiagnosticSessionReader,
  type PreviewDiagnosticSessionRecord,
} from "../src/lib/auth/preview-diagnostic-session";
import { hashSessionToken } from "../src/lib/auth/session-token";
import type { PasswordChangeTimestampComparison } from "../src/lib/auth/session-password-change";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const TOKEN = "A".repeat(43);
const VALID_COMPARISON: PasswordChangeTimestampComparison = {
  isNewer: true,
  isEqual: false,
  sessionCreatedAt: "2026-11-20T10:00:00.000000Z",
  passwordChangedAt: "2026-11-20T09:00:00.000000Z",
};

function session(
  overrides: Partial<Omit<PreviewDiagnosticSessionRecord, "user">> & {
    user?: Partial<PreviewDiagnosticSessionRecord["user"]>;
  } = {},
): PreviewDiagnosticSessionRecord {
  const { user: userOverrides, ...sessionOverrides } = overrides;
  return {
    id: "session-id",
    userId: "user-id",
    createdAt: new Date(NOW - 60 * 60 * 1000),
    expiresAt: new Date(NOW + 60 * 60 * 1000),
    lastSeenAt: new Date(NOW - 30 * 1000),
    revokedAt: null,
    user: {
      id: "user-id",
      role: "ADMIN",
      isActive: true,
      passwordChangedAt: new Date(NOW - 2 * 60 * 60 * 1000),
      ...userOverrides,
    },
    passwordChangeComparison: VALID_COMPARISON,
    ...sessionOverrides,
  };
}

function createReader(
  record: PreviewDiagnosticSessionRecord | null = session(),
  options: {
    currentRecord?: PreviewDiagnosticSessionRecord | null;
    afterCurrentRead?: () => void;
    findError?: Error;
    currentFindError?: Error;
  } = {},
) {
  const calls = {
    findByTokenHash: 0,
    findCurrentByTokenHashAndIdAndUser: 0,
    mutations: 0,
    receivedTokenHash: "",
    currentReadTokenHash: "",
    currentReadSessionId: "",
    currentReadUserId: "",
  };
  const reader: PreviewDiagnosticSessionReader & {
    updateMany(): void;
    update(): void;
    delete(): void;
    create(): void;
  } = {
    findByTokenHash: async (tokenHash) => {
      calls.findByTokenHash += 1;
      calls.receivedTokenHash = tokenHash;
      if (options.findError) throw options.findError;
      return record ? { id: record.id, userId: record.userId } : null;
    },
    findCurrentByTokenHashAndIdAndUser: async (tokenHash, sessionId, userId) => {
      calls.findCurrentByTokenHashAndIdAndUser += 1;
      calls.currentReadTokenHash = tokenHash;
      calls.currentReadSessionId = sessionId;
      calls.currentReadUserId = userId;
      if (options.currentFindError) throw options.currentFindError;
      const currentRecord = options.currentRecord === undefined
        ? record
        : options.currentRecord;
      if (
        tokenHash !== calls.receivedTokenHash ||
        !currentRecord ||
        currentRecord.id !== sessionId ||
        currentRecord.userId !== userId
      ) {
        return null;
      }
      options.afterCurrentRead?.();
      return currentRecord;
    },
    updateMany: () => { calls.mutations += 1; },
    update: () => { calls.mutations += 1; },
    delete: () => { calls.mutations += 1; },
    create: () => { calls.mutations += 1; },
  };
  return { reader, calls };
}

function request(token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("Cookie", `admin_session=${token}`);
  return new Request("https://preview.example.test/api/admin/preview-database-diagnostic", {
    headers,
  });
}

const validationOptions = { now: () => NOW, isDevelopment: false };

test("valid ADMIN session is accepted using the hash of the presented token", async () => {
  const { reader, calls } = createReader();
  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response, null);
  assert.equal(calls.findByTokenHash, 1);
  assert.equal(calls.receivedTokenHash, hashSessionToken(TOKEN));
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.currentReadTokenHash, hashSessionToken(TOKEN));
  assert.equal(calls.mutations, 0);
});

test("development sessions require the existing HMAC token verification", async () => {
  const globalWithKey = globalThis as typeof globalThis & {
    __bigyanAdminSessionDevelopmentKey?: Uint8Array;
  };
  const previousKey = globalWithKey.__bigyanAdminSessionDevelopmentKey;
  const key = new Uint8Array(32).fill(7);
  globalWithKey.__bigyanAdminSessionDevelopmentKey = key;

  try {
    const randomPart = new Uint8Array(32).fill(9);
    const tag = createHmac("sha256", key)
      .update(randomPart)
      .digest()
      .subarray(0, 16);
    const developmentToken = Buffer.concat([randomPart, tag]).toString("base64url");
    const invalidTag = Buffer.from(tag);
    invalidTag[0] = (invalidTag[0] ?? 0) ^ 0xff;
    const invalidToken = Buffer.concat([randomPart, invalidTag]).toString("base64url");
    const { reader, calls } = createReader();

    const valid = await validatePreviewDiagnosticAdminSession(
      developmentToken,
      reader,
      { now: () => NOW, isDevelopment: true },
    );
    const invalid = await validatePreviewDiagnosticAdminSession(
      invalidToken,
      reader,
      { now: () => NOW, isDevelopment: true },
    );

    assert.deepEqual(valid, { user: { role: "ADMIN" } });
    assert.equal(invalid, null);
    assert.equal(calls.findByTokenHash, 1);
    assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  } finally {
    globalWithKey.__bigyanAdminSessionDevelopmentKey = previousKey;
  }
});

test("EDITOR session is denied by the diagnostic validator", async () => {
  const { reader, calls } = createReader(session({ user: { role: "EDITOR" } }));
  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response?.status, 401);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.equal(calls.mutations, 0);
});

test("missing and malformed tokens are denied before session lookup", async () => {
  const { reader, calls } = createReader();
  const missing = await authorizePreviewDiagnosticAdminRead(
    request(),
    reader,
    validationOptions,
  );
  const malformed = await authorizePreviewDiagnosticAdminRead(
    request("not-a-session-token"),
    reader,
    validationOptions,
  );

  assert.equal(missing?.status, 401);
  assert.equal(malformed?.status, 401);
  assert.equal(calls.findByTokenHash, 0);
  assert.equal(calls.mutations, 0);
});

test("revoked, expired, idle-expired, invalidated, inactive, or malformed sessions are denied", async () => {
  const cases: Array<{
    label: string;
    record: PreviewDiagnosticSessionRecord;
  }> = [
    { label: "revoked", record: session({ revokedAt: new Date(NOW - 1000) }) },
    { label: "absolute expiry", record: session({ expiresAt: new Date(NOW) }) },
    {
      label: "idle timeout",
      record: session({ lastSeenAt: new Date(NOW - 15 * 60 * 1000) }),
    },
    {
      label: "password changed after session",
      record: session({
        user: { passwordChangedAt: new Date(NOW - 30 * 60 * 1000) },
        passwordChangeComparison: { ...VALID_COMPARISON, isNewer: false },
      }),
    },
    { label: "inactive account", record: session({ user: { isActive: false } }) },
    { label: "session ownership mismatch", record: session({ user: { id: "other-user" } }) },
    { label: "invalid timestamp", record: session({ lastSeenAt: new Date(Number.NaN) }) },
  ];

  for (const testCase of cases) {
    const { reader, calls } = createReader(testCase.record, {
      currentRecord: testCase.record,
    });
    const result = await validatePreviewDiagnosticAdminSession(
      TOKEN,
      reader,
      validationOptions,
    );
    assert.equal(result, null, testCase.label);
    assert.equal(calls.mutations, 0, testCase.label);
  }
});

test("unverifiable password-change state is denied without revoking the session", async () => {
  const { reader, calls } = createReader(session({
    passwordChangeComparison: null,
  }));
  const result = await validatePreviewDiagnosticAdminSession(
    TOKEN,
    reader,
    validationOptions,
  );

  assert.equal(result, null);
  assert.equal(calls.mutations, 0);
});

test("database lookup failures fail closed with the existing generic authorization response", async () => {
  const { reader, calls } = createReader(session(), {
    findError: new Error("private database failure"),
  });
  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response?.status, 500);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response?.json(), {
    error: "Unable to authorize this request.",
  });
  assert.equal(calls.mutations, 0);
});

test("failure of the final authoritative read fails closed without mutation", async () => {
  const { reader, calls } = createReader(session(), {
    currentFindError: new Error("private database failure"),
  });
  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response?.status, 500);
  assert.deepEqual(await response?.json(), {
    error: "Unable to authorize this request.",
  });
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("account deactivation after token lookup is denied by the authoritative read", async () => {
  const { reader, calls } = createReader(session(), {
    currentRecord: session({ user: { isActive: false } }),
  });

  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response?.status, 401);
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("ADMIN demotion after token lookup is denied by the authoritative role", async () => {
  const { reader, calls } = createReader(session(), {
    currentRecord: session({ user: { role: "EDITOR" } }),
  });

  const response = await authorizePreviewDiagnosticAdminRead(
    request(TOKEN),
    reader,
    validationOptions,
  );

  assert.equal(response?.status, 401);
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("stale activity is revalidated without changing timestamps or calling mutations", async () => {
  const record = session({ lastSeenAt: new Date(NOW - 90 * 1000) });
  const originalLastSeenAt = record.lastSeenAt.getTime();
  const originalExpiresAt = record.expiresAt.getTime();
  const { reader, calls } = createReader(record);

  const result = await validatePreviewDiagnosticAdminSession(
    TOKEN,
    reader,
    validationOptions,
  );

  assert.deepEqual(result, { user: { role: "ADMIN" } });
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
  assert.equal(record.lastSeenAt.getTime(), originalLastSeenAt);
  assert.equal(record.expiresAt.getTime(), originalExpiresAt);
});

test("idle expiration in the authoritative read is denied", async () => {
  const { reader, calls } = createReader(session(), {
    currentRecord: session({ lastSeenAt: new Date(NOW - 15 * 60 * 1000) }),
  });

  const result = await validatePreviewDiagnosticAdminSession(
    TOKEN,
    reader,
    validationOptions,
  );

  assert.equal(result, null);
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("absolute expiration is checked after the final authoritative read", async () => {
  let now = NOW;
  let clockReads = 0;
  const expiringSession = session({ expiresAt: new Date(NOW + 1) });
  const { reader, calls } = createReader(expiringSession, {
    afterCurrentRead: () => { now = NOW + 1; },
  });

  const result = await validatePreviewDiagnosticAdminSession(
    TOKEN,
    reader,
    {
      now: () => {
        clockReads += 1;
        return now;
      },
      isDevelopment: false,
    },
  );

  assert.equal(result, null);
  assert.equal(clockReads, 1);
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("concurrent session revocation is denied even for recently active sessions", async () => {
  const initial = session();
  const revoked = session({ revokedAt: new Date(NOW) });
  const { reader, calls } = createReader(initial, { currentRecord: revoked });

  const result = await validatePreviewDiagnosticAdminSession(
    TOKEN,
    reader,
    validationOptions,
  );

  assert.equal(result, null);
  assert.equal(calls.findCurrentByTokenHashAndIdAndUser, 1);
  assert.equal(calls.mutations, 0);
});

test("the diagnostic route uses the dedicated validator inside its read-only transaction", async () => {
  const route = await readFile(
    new URL("../src/app/api/admin/preview-database-diagnostic/route.ts", import.meta.url),
    "utf8",
  );
  const normalValidator = await readFile(
    new URL("../src/lib/auth/session.ts", import.meta.url),
    "utf8",
  );

  const readOnlyStart = route.indexOf(
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY",
  );
  const authorization = route.indexOf("authorizePreviewDiagnosticAdminRead(");
  const diagnosticRead = route.indexOf("collectPreviewDatabaseDiagnostic(");
  assert.ok(readOnlyStart >= 0 && readOnlyStart < authorization);
  assert.ok(authorization < diagnosticRead);
  assert.match(route, /authorizePreviewDiagnosticAdminRead/u);
  assert.doesNotMatch(route, /authorizeAdminOnlyContentRead|validateAdminSession/u);
  assert.match(normalValidator, /export async function validateAdminSession/u);
  assert.doesNotMatch(normalValidator, /validatePreviewDiagnosticAdminSession/u);
});
