import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import {
  assertIntegrationTestDatabaseServerIdentity,
  resolveIsolatedIntegrationTestDatabaseTarget,
  type IntegrationTestDatabaseServerIdentity,
} from "../../src/lib/integration-test-database";

function integrationEnvironment() {
  return {
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    developmentDatabaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
  };
}

async function inspectServerIdentity(
  connectionString: string,
): Promise<IntegrationTestDatabaseServerIdentity> {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query<IntegrationTestDatabaseServerIdentity>(
      `SELECT current_database() AS "databaseName", current_user AS "userName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"`,
    );
    const identity = result.rows[0];
    if (!identity) throw new Error("Missing integration database identity.");
    return identity;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Creates a Prisma client only after verifying the dedicated integration target.
 * Integration tests must use this factory instead of the application's Prisma singleton.
 */
export async function createIsolatedIntegrationPrismaClient(): Promise<PrismaClient> {
  const environment = integrationEnvironment();
  const target = resolveIsolatedIntegrationTestDatabaseTarget(environment);
  const connectionString = environment.testDatabaseUrl;
  if (!connectionString) {
    throw new Error("The integration test database target could not be verified.");
  }

  const identity = await inspectServerIdentity(connectionString);
  assertIntegrationTestDatabaseServerIdentity(target, identity);

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}
