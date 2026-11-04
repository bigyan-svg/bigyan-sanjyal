import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_RECOVERY_DATABASE_NAME,
  DEFAULT_RECOVERY_DATABASE_PORT,
  UnsafeRecoveryDatabaseTargetError,
  resolveRecoveryDatabaseTarget,
  withVerifiedRecoveryDatabaseTarget,
  type RecoveryDatabaseEnvironment,
  type RecoveryDatabaseServerIdentity,
} from "../src/lib/auth/password-recovery-database-target";

const LOCAL_DATABASE_URL = `postgresql://recovery-user:private-value@localhost:${DEFAULT_RECOVERY_DATABASE_PORT}/${DEFAULT_RECOVERY_DATABASE_NAME}?schema=public`;

function environment(
  overrides: Partial<RecoveryDatabaseEnvironment> = {},
): RecoveryDatabaseEnvironment {
  return {
    nodeEnv: "development",
    vercel: undefined,
    databaseUrl: LOCAL_DATABASE_URL,
    expectedDatabaseName: undefined,
    expectedDatabasePort: undefined,
    ...overrides,
  };
}

const LOCAL_SERVER: RecoveryDatabaseServerIdentity = {
  databaseName: DEFAULT_RECOVERY_DATABASE_NAME,
  serverAddress: "127.0.0.1",
  serverPort: DEFAULT_RECOVERY_DATABASE_PORT,
};

test("accepts the explicitly configured local development database", async () => {
  const target = resolveRecoveryDatabaseTarget(environment());
  assert.deepEqual(target, {
    host: "localhost",
    port: DEFAULT_RECOVERY_DATABASE_PORT,
    database: DEFAULT_RECOVERY_DATABASE_NAME,
  });

  let recoveryRan = false;
  await withVerifiedRecoveryDatabaseTarget(
    environment(),
    async () => LOCAL_SERVER,
    async (verifiedTarget) => {
      recoveryRan = true;
      assert.deepEqual(verifiedTarget, target);
    },
  );
  assert.equal(recoveryRan, true);
});

test("allows a custom local database name and port only through explicit development settings", () => {
  const target = resolveRecoveryDatabaseTarget(environment({
    databaseUrl: "postgresql://user:password@127.0.0.1:5544/portfolio_local?schema=public",
    expectedDatabaseName: "portfolio_local",
    expectedDatabasePort: "5544",
  }));

  assert.deepEqual(target, {
    host: "127.0.0.1",
    port: 5544,
    database: "portfolio_local",
  });
});

test("rejects remote database hosts without exposing the connection string", async () => {
  const remoteEnvironment = environment({
    databaseUrl: "postgresql://user:private-value@db.example.com:5432/bigyan_sanjyal_db",
  });
  assert.throws(
    () => resolveRecoveryDatabaseTarget(remoteEnvironment),
    (error: unknown) => {
      assert.ok(error instanceof UnsafeRecoveryDatabaseTargetError);
      assert.equal(error.message.includes("private-value"), false);
      assert.equal(error.message.includes("db.example.com"), false);
      return true;
    },
  );

  let inspectCalls = 0;
  let recoveryCalls = 0;
  await assert.rejects(
    withVerifiedRecoveryDatabaseTarget(
      remoteEnvironment,
      async () => {
        inspectCalls += 1;
        return LOCAL_SERVER;
      },
      async () => {
        recoveryCalls += 1;
      },
    ),
    UnsafeRecoveryDatabaseTargetError,
  );
  assert.equal(inspectCalls, 0);
  assert.equal(recoveryCalls, 0);
});

test("rejects production-named databases even when their URL is local", () => {
  assert.throws(
    () => resolveRecoveryDatabaseTarget(environment({
      databaseUrl: "postgresql://user:password@localhost:5432/production",
      expectedDatabaseName: "production",
    })),
    UnsafeRecoveryDatabaseTargetError,
  );
});

test("rejects missing and malformed DATABASE_URL values", () => {
  for (const databaseUrl of [undefined, "", "not a database url", "postgresql://[broken"]) {
    assert.throws(
      () => resolveRecoveryDatabaseTarget(environment({ databaseUrl })),
      UnsafeRecoveryDatabaseTargetError,
    );
  }
});

test("rejects an unexpected database name and unsafe expected-name override", () => {
  assert.throws(
    () => resolveRecoveryDatabaseTarget(environment({
      databaseUrl: "postgresql://user:password@localhost:5432/another_database",
    })),
    UnsafeRecoveryDatabaseTargetError,
  );
  for (const expectedDatabaseName of ["production", "portfolio_prod01"]) {
    assert.throws(
      () => resolveRecoveryDatabaseTarget(environment({ expectedDatabaseName })),
      UnsafeRecoveryDatabaseTargetError,
    );
  }
});

test("rejects query parameters that could override the actual connection target", () => {
  for (const databaseUrl of [
    `${LOCAL_DATABASE_URL}&host=db.example.com`,
    `${LOCAL_DATABASE_URL}&port=6543`,
    `${LOCAL_DATABASE_URL}&hostaddr=203.0.113.5`,
    `${LOCAL_DATABASE_URL}&schema=private`,
  ]) {
    assert.throws(
      () => resolveRecoveryDatabaseTarget(environment({ databaseUrl })),
      UnsafeRecoveryDatabaseTargetError,
    );
  }
});

test("rejects production and Vercel execution before database inspection", async () => {
  for (const rejectedEnvironment of [
    environment({ nodeEnv: "production" }),
    environment({ nodeEnv: "test" }),
    environment({ vercel: "1" }),
    environment({ vercel: "true" }),
  ]) {
    let inspectCalls = 0;
    let recoveryCalls = 0;
    await assert.rejects(
      withVerifiedRecoveryDatabaseTarget(
        rejectedEnvironment,
        async () => {
          inspectCalls += 1;
          return LOCAL_SERVER;
        },
        async () => {
          recoveryCalls += 1;
        },
      ),
      UnsafeRecoveryDatabaseTargetError,
    );
    assert.equal(inspectCalls, 0);
    assert.equal(recoveryCalls, 0);
  }
});

test("rejects a server identity that is remote or does not match the configured database", async () => {
  for (const identity of [
    { ...LOCAL_SERVER, serverAddress: "203.0.113.5" },
    { ...LOCAL_SERVER, databaseName: "production" },
    { ...LOCAL_SERVER, serverPort: 5544 },
    { ...LOCAL_SERVER, serverAddress: null },
  ]) {
    let recoveryCalls = 0;
    await assert.rejects(
      withVerifiedRecoveryDatabaseTarget(
        environment(),
        async () => identity,
        async () => {
          recoveryCalls += 1;
        },
      ),
      UnsafeRecoveryDatabaseTargetError,
    );
    assert.equal(recoveryCalls, 0);
  }
});

test("rejected targets never reach password update or session revocation", async () => {
  let passwordUpdates = 0;
  let sessionRevocations = 0;

  await assert.rejects(
    withVerifiedRecoveryDatabaseTarget(
      environment({ databaseUrl: "postgresql://user:password@remote.example/bigyan_sanjyal_db" }),
      async () => LOCAL_SERVER,
      async () => {
        passwordUpdates += 1;
        sessionRevocations += 1;
      },
    ),
    UnsafeRecoveryDatabaseTargetError,
  );

  assert.equal(passwordUpdates, 0);
  assert.equal(sessionRevocations, 0);
});
