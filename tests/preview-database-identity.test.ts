import assert from "node:assert/strict";
import { test } from "node:test";
import { hashSessionToken } from "../src/lib/auth/session-token";
import {
  getReadOnlyAdminSessionAuthorization,
  readPreviewDatabaseIdentity,
  type PreviewDatabaseIdentityResult,
  type ReadOnlyAdminSessionRecord,
  type ReadOnlyDiagnosticTransaction,
} from "../src/lib/preview-database-identity";
import { createPreviewDatabaseIdentityHandler } from "../src/lib/preview-database-identity-handler";

const now = Date.parse("2026-11-20T12:00:00.000Z");
const validToken = "a".repeat(43);

function sessionRecord(
  overrides: Partial<ReadOnlyAdminSessionRecord> = {},
): ReadOnlyAdminSessionRecord {
  return {
    createdAt: new Date(now - 60_000),
    expiresAt: new Date(now + 60_000),
    lastSeenAt: new Date(now - 30_000),
    revokedAt: null,
    passwordChangedAt: new Date(now - 120_000),
    role: "ADMIN",
    isActive: true,
    sessionCreatedAtEpochMicros: String((now - 60_000) * 1000),
    passwordChangedAtEpochMicros: String((now - 120_000) * 1000),
    sessionCreatedAtText: new Date(now - 60_000).toISOString(),
    passwordChangedAtText: new Date(now - 120_000).toISOString(),
    ...overrides,
  };
}

function identityRow() {
  return {
    databaseName: "neondb",
    currentUser: "private-db-user",
    serverAddress: "203.0.113.42",
    serverPort: 5432,
    transactionReadOnly: "on",
  };
}

function transaction(
  session: ReadOnlyAdminSessionRecord | null = sessionRecord(),
  transactionReadOnly = "on",
) {
  const calls: Array<{
    kind: "execute" | "query";
    sql: string;
    values: unknown[];
  }> = [];
  const tx: ReadOnlyDiagnosticTransaction = {
    $executeRaw: async (strings, ...values) => {
      calls.push({ kind: "execute", sql: strings.join("?"), values });
      return 0;
    },
    $queryRaw: async <T>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      calls.push({ kind: "query", sql, values });
      let result: unknown;

      if (sql.includes("current_database()")) {
        result = [identityRow()];
      } else if (sql.includes('FROM "AdminSession"')) {
        result = session ? [session] : [];
      } else if (sql.includes("current_setting('transaction_read_only')")) {
        result = [{ transactionReadOnly }];
      } else {
        throw new Error("Unexpected diagnostic query.");
      }

      return result as T;
    },
  };

  return { tx, calls };
}

function request(
  cookie?: string,
  method = "GET",
): Request {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("Cookie", cookie);
  return new Request("https://example.test/api/admin/preview-database-identity", {
    method,
    headers,
  });
}

test("production invocation is rejected before authentication or database access", async () => {
  let diagnostics = 0;
  const handler = createPreviewDatabaseIdentityHandler({
    environment: "production",
    runDiagnostic: async () => {
      diagnostics += 1;
      return { kind: "unauthenticated" };
    },
  });

  const response = await handler(request(`admin_session=${validToken}`));

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(diagnostics, 0);
});

test("non-GET requests are rejected without reading their body or running diagnostics", async () => {
  let diagnostics = 0;
  const handler = createPreviewDatabaseIdentityHandler({
    environment: "preview",
    runDiagnostic: async () => {
      diagnostics += 1;
      return { kind: "unauthenticated" };
    },
  });

  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handler(request(`admin_session=${validToken}`, method));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET", method);
  }
  assert.equal(diagnostics, 0);
});

test("unauthenticated requests are rejected without database access", async () => {
  let diagnostics = 0;
  const handler = createPreviewDatabaseIdentityHandler({
    environment: "preview",
    runDiagnostic: async () => {
      diagnostics += 1;
      return { kind: "unauthenticated" };
    },
  });

  const response = await handler(request());

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(diagnostics, 0);
});

test("authenticated non-admin roles are rejected", async () => {
  const handler = createPreviewDatabaseIdentityHandler({
    environment: "preview",
    runDiagnostic: async (): Promise<PreviewDatabaseIdentityResult> => ({
      kind: "non-admin",
    }),
  });

  const response = await handler(request(`admin_session=${validToken}`));

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("read-only session validation rejects revoked, expired, inactive, and password-invalidated sessions", () => {
  const invalidCases = [
    sessionRecord({ revokedAt: new Date(now - 1_000) }),
    sessionRecord({ expiresAt: new Date(now) }),
    sessionRecord({ isActive: false }),
    sessionRecord({
      sessionCreatedAtEpochMicros: String((now - 120_000) * 1000),
      passwordChangedAtEpochMicros: String((now - 60_000) * 1000),
    }),
  ];

  for (const session of invalidCases) {
    assert.equal(getReadOnlyAdminSessionAuthorization(session, now), "invalid");
  }
});

test("valid editor sessions are rejected before the database identity query", async () => {
  const { tx, calls } = transaction(sessionRecord({ role: "EDITOR" }));

  const result = await readPreviewDatabaseIdentity(
    tx,
    validToken,
    "ep-preview.example.neon.tech",
    now,
  );

  assert.deepEqual(result, { kind: "non-admin" });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ sql }) => !sql.includes("current_database()")));
});

test("read-only mode is established and verified before auth or identity SELECTs", async () => {
  const { tx, calls } = transaction();

  const result = await readPreviewDatabaseIdentity(
    tx,
    validToken,
    "ep-preview.example.neon.tech",
    now,
  );

  assert.equal(result.kind, "admin");
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ["execute", "query", "query", "query"],
  );
  assert.equal(calls[0].sql.trim(), "SET TRANSACTION READ ONLY");
  assert.match(calls[1].sql, /^\s*SELECT current_setting\('transaction_read_only'\)/u);
  assert.match(calls[2].sql, /^\s*SELECT[\s\S]+FROM "AdminSession"/u);
  assert.match(calls[3].sql, /^\s*SELECT\b/u);
  assert.match(calls[3].sql, /current_database\(\)/u);
  assert.equal(calls.filter(({ kind }) => kind === "execute").length, 1);
  assert.ok(calls.slice(1).every(({ kind, sql }) => kind === "query" && /^\s*SELECT\b/u.test(sql)));
  assert.deepEqual(calls[2].values, [hashSessionToken(validToken)]);
});

test("transaction read-only verification failure stops before session and identity queries", async () => {
  const { tx, calls } = transaction(sessionRecord(), "off");

  await assert.rejects(
    readPreviewDatabaseIdentity(tx, validToken, null, now),
    /transaction is not read-only/u,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, "execute");
  assert.match(calls[1].sql, /^\s*SELECT\b/u);
});

test("identity response omits database user, server address, credentials, and session data", async () => {
  const { tx } = transaction();
  const result = await readPreviewDatabaseIdentity(
    tx,
    validToken,
    "ep-preview.example.neon.tech",
    now,
  );
  assert.equal(result.kind, "admin");
  if (result.kind !== "admin") return;

  const serialized = JSON.stringify(result.identity);
  assert.deepEqual(result.identity, {
    hostname: "ep-preview.example.neon.tech",
    databaseName: "neondb",
    serverPort: 5432,
    transactionReadOnly: true,
    branchIdentity: { status: "branch_identity_unavailable" },
  });
  assert.doesNotMatch(
    serialized,
    /private-db-user|203\.0\.113\.42|admin_session|sessionId|password|token/u,
  );
});

test("branch identity is reported unavailable instead of inferred", async () => {
  const { tx } = transaction();
  const result = await readPreviewDatabaseIdentity(
    tx,
    validToken,
    "ep-preview.example.neon.tech",
    now,
  );

  assert.equal(result.kind, "admin");
  if (result.kind === "admin") {
    assert.deepEqual(result.identity.branchIdentity, {
      status: "branch_identity_unavailable",
    });
  }
});

test("authenticated response contains only sanitized database identity fields", async () => {
  const handler = createPreviewDatabaseIdentityHandler({
    environment: "preview",
    runDiagnostic: async (): Promise<PreviewDatabaseIdentityResult> => ({
      kind: "admin",
      identity: {
        hostname: "ep-preview.example.neon.tech",
        databaseName: "neondb",
        serverPort: 5432,
        transactionReadOnly: true,
        branchIdentity: { status: "branch_identity_unavailable" },
      },
    }),
  });

  const response = await handler(
    request("admin_session=unreturned-session-token"),
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(JSON.parse(body), {
    hostname: "ep-preview.example.neon.tech",
    databaseName: "neondb",
    serverPort: 5432,
    transactionReadOnly: true,
    branchIdentity: { status: "branch_identity_unavailable" },
  });
  assert.doesNotMatch(
    body,
    /unreturned-session-token|currentUser|private-db-user|password|connectionString/u,
  );
});
