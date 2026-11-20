import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizePreviewDiagnosticAdminRead } from "@/lib/auth/preview-diagnostic-session";
import type { PreviewDiagnosticSessionReader } from "@/lib/auth/preview-diagnostic-session";
import {
  collectPreviewDatabaseDiagnostic,
  handlePreviewDatabaseDiagnosticRequest,
  runPreviewDatabaseDiagnosticInReadOnlyTransaction,
  type PreviewDatabaseDiagnostic,
} from "@/lib/preview-database-diagnostic";
import { compareSessionPasswordChangeTimestamps } from "@/lib/auth/session-password-change";
import { prisma } from "@/lib/prisma";

type DiagnosticTransaction = Prisma.TransactionClient;

interface DatabaseIdentityRow {
  currentDatabase: string;
  currentUser: string;
  serverAddress: string | null;
  serverPort: number | null;
  transactionReadOnly: boolean;
}

interface MigrationTableExistsRow {
  exists: boolean;
}

interface MigrationCountRow {
  migrationCount: bigint;
  completedMigrationCount: bigint;
  rolledBackMigrationCount: bigint;
}

interface PasswordChangeRow {
  sessionCreatedAtEpochMicros: string;
  passwordChangedAtEpochMicros: string;
  sessionCreatedAt: string;
  passwordChangedAt: string;
}

interface CurrentSessionRow extends PasswordChangeRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  accountId: string;
  role: string;
  isActive: boolean;
  accountPasswordChangedAt: Date;
}

async function requireSingleRow<Row>(rowsPromise: Promise<Row[]>): Promise<Row> {
  const rows = await rowsPromise;
  const [row] = rows;
  if (rows.length !== 1 || !row) {
    throw new Error("The diagnostic query returned an unexpected result.");
  }
  return row;
}

function createSessionReader(transaction: DiagnosticTransaction): PreviewDiagnosticSessionReader {
  return {
    findByTokenHash: (tokenHash) =>
      transaction.adminSession.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      }),
    findCurrentByTokenHashAndIdAndUser: async (tokenHash, sessionId, userId) => {
      const row = await requireSingleRowOrNull<CurrentSessionRow>(
        transaction.$queryRaw<CurrentSessionRow[]>`
          SELECT
            admin_session."id" AS "id",
            admin_session."userId" AS "userId",
            admin_session."createdAt" AS "createdAt",
            admin_session."expiresAt" AS "expiresAt",
            admin_session."lastSeenAt" AS "lastSeenAt",
            admin_session."revokedAt" AS "revokedAt",
            admin_user."id" AS "accountId",
            admin_user."role" AS "role",
            admin_user."isActive" AS "isActive",
            admin_user."passwordChangedAt" AS "accountPasswordChangedAt",
            floor(extract(epoch FROM admin_session."createdAt") * 1000000)::bigint::text
              AS "sessionCreatedAtEpochMicros",
            floor(extract(epoch FROM admin_user."passwordChangedAt") * 1000000)::bigint::text
              AS "passwordChangedAtEpochMicros",
            to_char(
              admin_session."createdAt" AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS "sessionCreatedAt",
            to_char(
              admin_user."passwordChangedAt" AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            ) AS "passwordChangedAt"
          FROM "AdminSession" AS admin_session
          INNER JOIN "AdminUser" AS admin_user
            ON admin_user."id" = admin_session."userId"
          WHERE admin_session."id" = ${sessionId}
            AND admin_session."userId" = ${userId}
            AND admin_session."tokenHash" = ${tokenHash}
        `,
      );
      if (!row) return null;

      return {
        id: row.id,
        userId: row.userId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        lastSeenAt: row.lastSeenAt,
        revokedAt: row.revokedAt,
        user: {
          id: row.accountId,
          role: row.role,
          isActive: row.isActive,
          passwordChangedAt: row.accountPasswordChangedAt,
        },
        passwordChangeComparison: compareSessionPasswordChangeTimestamps(
          row.sessionCreatedAtEpochMicros,
          row.passwordChangedAtEpochMicros,
          row.sessionCreatedAt,
          row.passwordChangedAt,
        ),
      };
    },
  };
}

async function requireSingleRowOrNull<Row>(rowsPromise: Promise<Row[]>): Promise<Row | null> {
  const rows = await rowsPromise;
  if (rows.length > 1) {
    throw new Error("The diagnostic query returned an unexpected result.");
  }
  return rows[0] ?? null;
}

function createDiagnosticQueries(transaction: DiagnosticTransaction) {
  return {
    getDatabaseIdentity: async () =>
      requireSingleRow<DatabaseIdentityRow>(
        transaction.$queryRaw<DatabaseIdentityRow[]>`
          SELECT
            current_database() AS "currentDatabase",
            current_user AS "currentUser",
            inet_server_addr()::text AS "serverAddress",
            inet_server_port() AS "serverPort",
            current_setting('transaction_read_only') = 'on' AS "transactionReadOnly"
        `,
      ),
    migrationMetadataTableExists: async () => {
      const row = await requireSingleRow<MigrationTableExistsRow>(
        transaction.$queryRaw<MigrationTableExistsRow[]>`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = '_prisma_migrations'
              AND table_type = 'BASE TABLE'
          ) AS "exists"
        `,
      );
      return row.exists;
    },
    getMigrationCounts: async () =>
      requireSingleRow<MigrationCountRow>(
        transaction.$queryRaw<MigrationCountRow[]>`
          SELECT
            COUNT(*) AS "migrationCount",
            COUNT(*) FILTER (
              WHERE "finished_at" IS NOT NULL
                AND "rolled_back_at" IS NULL
            ) AS "completedMigrationCount",
            COUNT(*) FILTER (
              WHERE "rolled_back_at" IS NOT NULL
            ) AS "rolledBackMigrationCount"
          FROM "_prisma_migrations"
        `,
      ),
  };
}

async function executePreviewDatabaseDiagnostic(
  request: Request,
): Promise<Response | PreviewDatabaseDiagnostic> {
  return prisma.$transaction(async (transaction) => {
    return runPreviewDatabaseDiagnosticInReadOnlyTransaction({
      setTransactionReadOnly: () =>
        transaction.$executeRaw`SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY`,
      authorize: () =>
        authorizePreviewDiagnosticAdminRead(request, createSessionReader(transaction)),
      collect: () =>
        collectPreviewDatabaseDiagnostic(createDiagnosticQueries(transaction)),
    });
  },
    { maxWait: 5000, timeout: 5000 },
  );
}

function logDiagnosticFailure(phase: "authorization" | "database"): void {
  console.error("[temporary-preview-database-diagnostic] Request failed.", { phase });
}

// TEMPORARY: Remove this Preview-only diagnostic after database identity verification.
export async function GET(request: Request): Promise<Response> {
  return handlePreviewDatabaseDiagnosticRequest(request, {
    isPreview: process.env.VERCEL_ENV === "preview",
    executeReadOnly: executePreviewDatabaseDiagnostic,
    logFailure: () => logDiagnosticFailure("database"),
  });
}
