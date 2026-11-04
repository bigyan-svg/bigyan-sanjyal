import dotenv from "dotenv";
import { Client } from "pg";
import {
  assertIntegrationTestDatabaseServerIdentity,
  resolveIsolatedIntegrationTestDatabaseTarget,
  type IntegrationTestDatabaseServerIdentity,
} from "../src/lib/integration-test-database";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.integration.local", override: false, quiet: true });

async function main(): Promise<void> {
  let stage = "target-validation";
  let client: Client | null = null;
  const requireEmpty = process.argv.includes("--require-empty");
  const verifySchema = process.argv.includes("--verify-schema");
  const verifyFixturesClean = process.argv.includes("--verify-fixtures-clean");
  try {
    const target = resolveIsolatedIntegrationTestDatabaseTarget({
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
      developmentDatabaseUrl: process.env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
      vercel: process.env.VERCEL,
    });

    stage = "connect";
    client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await client.connect();

    stage = "server-identity";
    const identityResult = await client.query<IntegrationTestDatabaseServerIdentity>(
      `SELECT current_database() AS "databaseName", current_user AS "userName", host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort"`,
    );
    const identity = identityResult.rows[0];
    if (!identity) throw new Error("Missing database identity.");
    assertIntegrationTestDatabaseServerIdentity(target, identity);

    stage = "empty-database-check";
    const tableResult = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    const publicTableCount = Number(tableResult.rows[0]?.count ?? Number.NaN);
    if (
      !Number.isSafeInteger(publicTableCount) ||
      (requireEmpty && publicTableCount !== 0)
    ) {
      throw new Error("The integration test database is not empty.");
    }

    if (verifySchema) {
      stage = "schema-check";
      const requiredColumns = new Map<string, readonly string[]>([
        ["Project", ["id", "version"]],
        ["Post", ["id", "version", "categoryId"]],
        ["PostCategory", ["id"]],
        ["Tag", ["id"]],
        ["PostTag", ["postId", "tagId"]],
        ["Education", ["id", "version"]],
        ["WorkExperience", ["id", "version", "employmentType"]],
      ]);
      const columnResult = await client.query<{ tableName: string; columnName: string }>(
        `SELECT table_name AS "tableName", column_name AS "columnName"
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])`,
        [[...requiredColumns.keys()]],
      );
      const columnsByTable = new Map<string, Set<string>>();
      for (const column of columnResult.rows) {
        const columns = columnsByTable.get(column.tableName) ?? new Set<string>();
        columns.add(column.columnName);
        columnsByTable.set(column.tableName, columns);
      }
      for (const [tableName, columns] of requiredColumns) {
        const actualColumns = columnsByTable.get(tableName);
        if (!actualColumns || columns.some((column) => !actualColumns.has(column))) {
          throw new Error("The integration test schema is incomplete.");
        }
      }
    }

    if (verifyFixturesClean) {
      stage = "fixture-cleanup-check";
      const fixtureTables = [
        "Project",
        "Post",
        "Tag",
        "PostCategory",
        "PostTag",
        "Education",
        "WorkExperience",
      ] as const;
      const fixtureCounts: number[] = [];
      for (const tableName of fixtureTables) {
        const countResult = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${tableName}"`,
        );
        fixtureCounts.push(Number(countResult.rows[0]?.count ?? Number.NaN));
      }
      if (fixtureCounts.some((count) => !Number.isSafeInteger(count) || count !== 0)) {
        throw new Error("The integration test fixtures were not cleaned up.");
      }
    }

    console.log(JSON.stringify({
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      publicTableCount,
      requireEmpty,
      schemaVerified: verifySchema,
      fixturesClean: verifyFixturesClean,
    }));
  } catch {
    console.error(JSON.stringify({
      status: "failed",
      stage,
    }));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}

main().catch(() => {
  console.error(JSON.stringify({
    status: "failed",
    stage: "unexpected",
  }));
  process.exitCode = 1;
});
