import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  collectPreviewDatabaseDiagnostic,
  handlePreviewDatabaseDiagnosticRequest,
  runPreviewDatabaseDiagnosticInReadOnlyTransaction,
  type PreviewDatabaseDiagnostic,
  type PreviewDatabaseDiagnosticQueries,
} from "../src/lib/preview-database-diagnostic";

const identity = {
  currentDatabase: "preview_database",
  currentUser: "preview_runtime_role",
  serverAddress: "192.0.2.10",
  serverPort: 5432,
  transactionReadOnly: true,
};

const diagnostic: PreviewDatabaseDiagnostic = {
  ...identity,
  transactionReadOnly: true,
  migrationMetadataTableExists: true,
  migrationCount: 6,
  completedMigrationCount: 6,
  rolledBackMigrationCount: 0,
};

function request(): Request {
  return new Request("https://preview.example.test/api/admin/preview-database-diagnostic");
}

function queries(
  overrides: Partial<PreviewDatabaseDiagnosticQueries> = {},
): PreviewDatabaseDiagnosticQueries {
  return {
    getDatabaseIdentity: async () => identity,
    migrationMetadataTableExists: async () => true,
    getMigrationCounts: async () => ({
      migrationCount: BigInt(6),
      completedMigrationCount: BigInt(6),
      rolledBackMigrationCount: BigInt(0),
    }),
    ...overrides,
  };
}

test("diagnostic handler denies access outside Preview before opening a transaction", async () => {
  let executions = 0;
  const response = await handlePreviewDatabaseDiagnosticRequest(request(), {
    isPreview: false,
    executeReadOnly: async () => {
      executions += 1;
      return diagnostic;
    },
    logFailure: () => assert.fail("Expected no failure logging."),
  });

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(executions, 0);
});

test("authorized diagnostic execution returns only its typed no-store response", async () => {
  const response = await handlePreviewDatabaseDiagnosticRequest(request(), {
    isPreview: true,
    executeReadOnly: async () => diagnostic,
    logFailure: () => assert.fail("Expected no failure logging."),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), diagnostic);
});

test("authorization denial is returned without producing diagnostic output", async () => {
  const denied = Response.json(
    { error: "You are not authorized." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
  const response = await handlePreviewDatabaseDiagnosticRequest(request(), {
    isPreview: true,
    executeReadOnly: async () => {
      return denied;
    },
    logFailure: () => assert.fail("Expected no failure logging."),
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "You are not authorized." });
});

test("migration metadata absence returns null counts and skips the count query", async () => {
  let countQueries = 0;
  const result = await collectPreviewDatabaseDiagnostic(
    queries({
      migrationMetadataTableExists: async () => false,
      getMigrationCounts: async () => {
        countQueries += 1;
        return {
          migrationCount: BigInt(6),
          completedMigrationCount: BigInt(6),
          rolledBackMigrationCount: BigInt(0),
        };
      },
    }),
  );

  assert.equal(result.transactionReadOnly, true);
  assert.equal(result.migrationMetadataTableExists, false);
  assert.equal(result.migrationCount, null);
  assert.equal(result.completedMigrationCount, null);
  assert.equal(result.rolledBackMigrationCount, null);
  assert.equal(countQueries, 0);
});

test("diagnostic data is rejected unless the enclosing transaction is read-only", async () => {
  await assert.rejects(
    collectPreviewDatabaseDiagnostic(
      queries({
        getDatabaseIdentity: async () => ({
          ...identity,
          transactionReadOnly: false,
        }),
      }),
    ),
    /not read-only/u,
  );
});

test("execution errors return a generic no-store response without error details", async () => {
  let failures = 0;
  const response = await handlePreviewDatabaseDiagnosticRequest(request(), {
    isPreview: true,
    executeReadOnly: async () => {
      throw new Error("private SQL and connection details");
    },
    logFailure: () => { failures += 1; },
  });
  const body = await response.text();

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(failures, 1);
  assert.doesNotMatch(body, /private SQL|connection details/u);
});

test("read-only transaction setup failure fails closed before authorization or diagnostic reads", async () => {
  let authorizationCalls = 0;
  let diagnosticCalls = 0;
  let failures = 0;
  const response = await handlePreviewDatabaseDiagnosticRequest(request(), {
    isPreview: true,
    executeReadOnly: () =>
      runPreviewDatabaseDiagnosticInReadOnlyTransaction({
        setTransactionReadOnly: async () => {
          throw new Error("read-only transaction setup failed");
        },
        authorize: async () => {
          authorizationCalls += 1;
          return null;
        },
        collect: async () => {
          diagnosticCalls += 1;
          return diagnostic;
        },
      }),
    logFailure: () => { failures += 1; },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Database diagnostic unavailable.",
  });
  assert.equal(authorizationCalls, 0);
  assert.equal(diagnosticCalls, 0);
  assert.equal(failures, 1);
});

test("route keeps read-only setup before authorization and diagnostics", async () => {
  const route = await readFile(
    new URL("../src/app/api/admin/preview-database-diagnostic/route.ts", import.meta.url),
    "utf8",
  );
  const readOnlyStart = route.indexOf(
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY",
  );
  const authorization = route.indexOf("authorizePreviewDiagnosticAdminRead(");
  const diagnosticRead = route.indexOf("collectPreviewDatabaseDiagnostic(");

  assert.ok(readOnlyStart >= 0 && readOnlyStart < authorization);
  assert.ok(authorization < diagnosticRead);
  assert.match(route, /process\.env\.VERCEL_ENV === "preview"/u);
});
