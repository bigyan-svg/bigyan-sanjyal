import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  getSafeDatabaseTarget,
  logAdminAuthDiagnostic,
  type SafeDatabaseTarget,
} from "@/lib/auth/auth-diagnostics";
import { createLazyClient } from "@/lib/lazy-client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  adminAuthDatabaseTarget?: SafeDatabaseTarget | null;
  adminAuthDatabaseTargetSource?: "client-initialization" | "existing-client-env-fallback";
};

type PrismaDatabaseIdentitySource =
  | "client-initialization"
  | "existing-client-env-fallback"
  | "uninitialized";

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("The DATABASE_URL environment variable is not set.");
  }

  const databaseTarget = getSafeDatabaseTarget(connectionString);
  globalForPrisma.adminAuthDatabaseTarget = databaseTarget;
  globalForPrisma.adminAuthDatabaseTargetSource = "client-initialization";
  logAdminAuthDiagnostic(
    {
      boundary: "prisma",
      outcome: "initialized",
      databaseTargetSource: "client-initialization",
    },
    databaseTarget,
  );

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function ensureExistingClientDiagnostics(): void {
  if (globalForPrisma.prisma && !globalForPrisma.adminAuthDatabaseTargetSource) {
    globalForPrisma.adminAuthDatabaseTarget = getSafeDatabaseTarget(
      process.env.DATABASE_URL,
    );
    globalForPrisma.adminAuthDatabaseTargetSource = "existing-client-env-fallback";
    logAdminAuthDiagnostic(
      {
        boundary: "prisma",
        outcome: "initialized",
        databaseTargetSource: "existing-client-env-fallback",
      },
      globalForPrisma.adminAuthDatabaseTarget,
    );
  }
}

const lazyPrisma = createLazyClient(
  createPrismaClient,
  () => {
    const client = globalForPrisma.prisma;
    if (client) ensureExistingClientDiagnostics();
    return client;
  },
  (client) => {
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
    }
  },
);

export const prisma = lazyPrisma.client;

export function getPrismaDatabaseIdentity(): {
  target: SafeDatabaseTarget | null;
  source: PrismaDatabaseIdentitySource;
} {
  if (!lazyPrisma.peekClient()) {
    return {
      target: getSafeDatabaseTarget(process.env.DATABASE_URL),
      source: "uninitialized",
    };
  }
  ensureExistingClientDiagnostics();

  return {
    target: globalForPrisma.adminAuthDatabaseTarget ?? null,
    source: globalForPrisma.adminAuthDatabaseTargetSource ?? "existing-client-env-fallback",
  };
}
