import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { resolveIsolatedIntegrationTestDatabaseTarget } from "./src/lib/integration-test-database";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.integration.local", override: false, quiet: true });

resolveIsolatedIntegrationTestDatabaseTarget({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
  vercel: process.env.VERCEL,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.TEST_DATABASE_URL,
  },
});
