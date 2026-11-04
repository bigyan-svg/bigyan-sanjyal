import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTEGRATION_TEST_DATABASE_HOST,
  INTEGRATION_TEST_DATABASE_NAME,
  INTEGRATION_TEST_DATABASE_PORT,
  INTEGRATION_TEST_DATABASE_USER,
  PHASE38_TEST_DATABASE_NAME,
  PHASE38_TEST_DATABASE_PORT,
  PHASE38_TEST_DATABASE_USER,
  UnsafeIntegrationTestDatabaseTargetError,
  resolveIsolatedIntegrationTestDatabaseTarget,
  withVerifiedIntegrationTestDatabaseTarget,
  type IntegrationTestDatabaseEnvironment,
  type IntegrationTestDatabaseServerIdentity,
} from "../src/lib/integration-test-database";

const TEST_DATABASE_URL = `postgresql://${INTEGRATION_TEST_DATABASE_USER}:test-only-password@${INTEGRATION_TEST_DATABASE_HOST}:${INTEGRATION_TEST_DATABASE_PORT}/${INTEGRATION_TEST_DATABASE_NAME}?schema=public`;
const DEVELOPMENT_DATABASE_URL = "postgresql://development-user:development-password@localhost:5432/bigyan_sanjyal_db?schema=public";

const TEST_SERVER: IntegrationTestDatabaseServerIdentity = {
  databaseName: INTEGRATION_TEST_DATABASE_NAME,
  userName: INTEGRATION_TEST_DATABASE_USER,
  serverAddress: INTEGRATION_TEST_DATABASE_HOST,
  serverPort: INTEGRATION_TEST_DATABASE_PORT,
};

function environment(
  overrides: Partial<IntegrationTestDatabaseEnvironment> = {},
): IntegrationTestDatabaseEnvironment {
  return {
    testDatabaseUrl: TEST_DATABASE_URL,
    developmentDatabaseUrl: DEVELOPMENT_DATABASE_URL,
    nodeEnv: "test",
    vercel: undefined,
    ...overrides,
  };
}

test("accepts only the explicit isolated integration target", async () => {
  const target = resolveIsolatedIntegrationTestDatabaseTarget(environment());
  assert.deepEqual(target, {
    host: INTEGRATION_TEST_DATABASE_HOST,
    port: INTEGRATION_TEST_DATABASE_PORT,
    database: INTEGRATION_TEST_DATABASE_NAME,
    user: INTEGRATION_TEST_DATABASE_USER,
  });

  let operationRan = false;
  await withVerifiedIntegrationTestDatabaseTarget(
    environment(),
    async () => TEST_SERVER,
    async (verifiedTarget) => {
      operationRan = true;
      assert.deepEqual(verifiedTarget, target);
    },
  );
  assert.equal(operationRan, true);
});

test("accepts the exact Phase38 target through explicit local host representations", async () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const testDatabaseUrl = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@${host}:${PHASE38_TEST_DATABASE_PORT}/${PHASE38_TEST_DATABASE_NAME}?schema=public`;
    const target = resolveIsolatedIntegrationTestDatabaseTarget(
      environment({ testDatabaseUrl }),
    );
    assert.deepEqual(target, {
      host: "127.0.0.1",
      port: PHASE38_TEST_DATABASE_PORT,
      database: PHASE38_TEST_DATABASE_NAME,
      user: PHASE38_TEST_DATABASE_USER,
    });

    await withVerifiedIntegrationTestDatabaseTarget(
      environment({ testDatabaseUrl }),
      async () => ({
        databaseName: PHASE38_TEST_DATABASE_NAME,
        userName: PHASE38_TEST_DATABASE_USER,
        serverAddress: host === "[::1]" ? "::1" : "127.0.0.1",
        serverPort: PHASE38_TEST_DATABASE_PORT,
      }),
      async () => undefined,
    );
  }
});

test("rejects missing, malformed, remote, and unexpected test targets before inspection", async () => {
  for (const testDatabaseUrl of [
    undefined,
    "",
    "not-a-url",
    "postgresql://test:test@localhost:55432/other_test?schema=public",
    `postgresql://${INTEGRATION_TEST_DATABASE_USER}:test-only-password@localhost:${INTEGRATION_TEST_DATABASE_PORT}/${INTEGRATION_TEST_DATABASE_NAME}?schema=public`,
    `postgresql://${INTEGRATION_TEST_DATABASE_USER}:test-only-password@${INTEGRATION_TEST_DATABASE_HOST}:5432/${INTEGRATION_TEST_DATABASE_NAME}?schema=public`,
    `postgresql://${INTEGRATION_TEST_DATABASE_USER}:test-only-password@db.example.test:${INTEGRATION_TEST_DATABASE_PORT}/${INTEGRATION_TEST_DATABASE_NAME}?schema=public`,
    `postgresql://other-user:test-only-password@${INTEGRATION_TEST_DATABASE_HOST}:${INTEGRATION_TEST_DATABASE_PORT}/${INTEGRATION_TEST_DATABASE_NAME}?schema=public`,
    `${TEST_DATABASE_URL}&host=localhost`,
  ]) {
    let inspections = 0;
    let operations = 0;
    await assert.rejects(
      withVerifiedIntegrationTestDatabaseTarget(
        environment({ testDatabaseUrl }),
        async () => {
          inspections += 1;
          return TEST_SERVER;
        },
        async () => {
          operations += 1;
        },
      ),
      UnsafeIntegrationTestDatabaseTargetError,
    );
    assert.equal(inspections, 0);
    assert.equal(operations, 0);
  }
});

test("rejects incorrect Phase38 database, role, port, and unambiguous local-host violations", async () => {
  for (const target of [
    { host: "localhost", port: PHASE38_TEST_DATABASE_PORT, database: "wrong_database", user: PHASE38_TEST_DATABASE_USER },
    { host: "localhost", port: PHASE38_TEST_DATABASE_PORT, database: PHASE38_TEST_DATABASE_NAME, user: "wrong_role" },
    { host: "localhost", port: 5433, database: PHASE38_TEST_DATABASE_NAME, user: PHASE38_TEST_DATABASE_USER },
    { host: "127.1", port: PHASE38_TEST_DATABASE_PORT, database: PHASE38_TEST_DATABASE_NAME, user: PHASE38_TEST_DATABASE_USER },
    { host: "localhost.", port: PHASE38_TEST_DATABASE_PORT, database: PHASE38_TEST_DATABASE_NAME, user: PHASE38_TEST_DATABASE_USER },
    { host: "db.example.test", port: PHASE38_TEST_DATABASE_PORT, database: PHASE38_TEST_DATABASE_NAME, user: PHASE38_TEST_DATABASE_USER },
  ]) {
    const url = `postgresql://${target.user}:test-only-password@${target.host}:${target.port}/${target.database}?schema=public`;
    assert.throws(
      () => resolveIsolatedIntegrationTestDatabaseTarget(
        environment({ testDatabaseUrl: url }),
      ),
      UnsafeIntegrationTestDatabaseTargetError,
    );
  }

  const unexpectedRoutingParameter = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@localhost:${PHASE38_TEST_DATABASE_PORT}/${PHASE38_TEST_DATABASE_NAME}?options=-c%20search_path=public`;
  assert.throws(
    () => resolveIsolatedIntegrationTestDatabaseTarget(
      environment({ testDatabaseUrl: unexpectedRoutingParameter }),
    ),
    UnsafeIntegrationTestDatabaseTargetError,
  );
  const emptyPort = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@localhost:/${PHASE38_TEST_DATABASE_NAME}?schema=public`;
  assert.throws(
    () => resolveIsolatedIntegrationTestDatabaseTarget(
      environment({ testDatabaseUrl: emptyPort }),
    ),
    UnsafeIntegrationTestDatabaseTargetError,
  );
});

test("rejects a production database and a target matching DATABASE_URL", async () => {
  const productionDatabaseUrl = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@localhost:${PHASE38_TEST_DATABASE_PORT}/bigyan_sanjyal_db?schema=public`;
  const matchingDatabaseUrl = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@127.0.0.1:${PHASE38_TEST_DATABASE_PORT}/${PHASE38_TEST_DATABASE_NAME}?schema=public`;
  const matchingTestUrl = `postgresql://${PHASE38_TEST_DATABASE_USER}:test-only-password@localhost:${PHASE38_TEST_DATABASE_PORT}/${PHASE38_TEST_DATABASE_NAME}?schema=public`;
  for (const rejectedEnvironment of [
    environment({ testDatabaseUrl: productionDatabaseUrl }),
    environment({ testDatabaseUrl: matchingTestUrl, developmentDatabaseUrl: matchingDatabaseUrl }),
  ]) {
    assert.throws(
      () => resolveIsolatedIntegrationTestDatabaseTarget(rejectedEnvironment),
      UnsafeIntegrationTestDatabaseTargetError,
    );
  }
});

test("rejects a target matching development plus production and Vercel execution", async () => {
  for (const rejectedEnvironment of [
    environment({ developmentDatabaseUrl: TEST_DATABASE_URL }),
    environment({ nodeEnv: "production" }),
    environment({ vercel: "1" }),
  ]) {
    let inspections = 0;
    await assert.rejects(
      withVerifiedIntegrationTestDatabaseTarget(
        rejectedEnvironment,
        async () => {
          inspections += 1;
          return TEST_SERVER;
        },
        async () => undefined,
      ),
      UnsafeIntegrationTestDatabaseTargetError,
    );
    assert.equal(inspections, 0);
  }
});

test("rejects a connected server that does not exactly match the isolated target", async () => {
  for (const identity of [
    { ...TEST_SERVER, databaseName: "other_test_database" },
    { ...TEST_SERVER, userName: "other_test_user" },
    { ...TEST_SERVER, serverAddress: "127.0.0.2" },
    { ...TEST_SERVER, serverPort: 55433 },
  ]) {
    let operations = 0;
    await assert.rejects(
      withVerifiedIntegrationTestDatabaseTarget(
        environment(),
        async () => identity,
        async () => {
          operations += 1;
        },
      ),
      UnsafeIntegrationTestDatabaseTargetError,
    );
    assert.equal(operations, 0);
  }
});
