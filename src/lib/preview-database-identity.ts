import "server-only";

import {
  getAdminSessionLifetimeRejection,
  isAdminSessionRevoked,
} from "@/lib/auth/session-policy";
import { compareSessionPasswordChangeTimestamps } from "@/lib/auth/session-password-change";
import {
  hashSessionToken,
  isCurrentDevelopmentSessionToken,
} from "@/lib/auth/session-token";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ReadOnlyDiagnosticTransaction {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

export interface ReadOnlyAdminSessionRecord {
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  passwordChangedAt: Date;
  role: "ADMIN" | "EDITOR";
  isActive: boolean;
  sessionCreatedAtEpochMicros: string;
  passwordChangedAtEpochMicros: string;
  sessionCreatedAtText: string;
  passwordChangedAtText: string;
}

export interface PreviewDatabaseIdentity {
  hostname: string | null;
  databaseName: string;
  serverPort: number | null;
  transactionReadOnly: true;
  branchIdentity: {
    status: "branch_identity_unavailable";
  };
}

export type PreviewDatabaseIdentityResult =
  | { kind: "unauthenticated" }
  | { kind: "non-admin" }
  | { kind: "admin"; identity: PreviewDatabaseIdentity };

export function getReadOnlyAdminSessionAuthorization(
  session: ReadOnlyAdminSessionRecord | null,
  now = Date.now(),
): "invalid" | "admin" | "non-admin" {
  if (!session || isAdminSessionRevoked(session.revokedAt)) return "invalid";

  const timestamps = [
    session.createdAt,
    session.expiresAt,
    session.lastSeenAt,
    session.passwordChangedAt,
  ];
  if (
    timestamps.some(
      (timestamp) =>
        !(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime()),
    )
  ) {
    return "invalid";
  }

  const passwordTimestampComparison = compareSessionPasswordChangeTimestamps(
    session.sessionCreatedAtEpochMicros,
    session.passwordChangedAtEpochMicros,
    session.sessionCreatedAtText,
    session.passwordChangedAtText,
  );
  if (!passwordTimestampComparison?.isNewer || !session.isActive) {
    return "invalid";
  }

  if (
    getAdminSessionLifetimeRejection(
      session.expiresAt,
      session.lastSeenAt,
      now,
    ) !== null
  ) {
    return "invalid";
  }

  return session.role === "ADMIN" ? "admin" : "non-admin";
}

function isValidSessionToken(token: string): boolean {
  return process.env.NODE_ENV === "development"
    ? isCurrentDevelopmentSessionToken(token)
    : SESSION_TOKEN_PATTERN.test(token);
}

export async function readPreviewDatabaseIdentity(
  transaction: ReadOnlyDiagnosticTransaction,
  token: string,
  hostname: string | null,
  now = Date.now(),
): Promise<PreviewDatabaseIdentityResult> {
  await transaction.$executeRaw`SET TRANSACTION READ ONLY`;

  const [readOnlyState] = await transaction.$queryRaw<
    { transactionReadOnly: string }[]
  >`
    SELECT current_setting('transaction_read_only') AS "transactionReadOnly"
  `;
  if (readOnlyState?.transactionReadOnly !== "on") {
    throw new Error("The diagnostic transaction is not read-only.");
  }

  if (!isValidSessionToken(token)) return { kind: "unauthenticated" };

  const [session] = await transaction.$queryRaw<ReadOnlyAdminSessionRecord[]>`
    SELECT
      admin_session."createdAt" AS "createdAt",
      admin_session."expiresAt" AS "expiresAt",
      admin_session."lastSeenAt" AS "lastSeenAt",
      admin_session."revokedAt" AS "revokedAt",
      admin_user."passwordChangedAt" AS "passwordChangedAt",
      admin_user."role" AS "role",
      admin_user."isActive" AS "isActive",
      floor(
        extract(epoch FROM admin_session."createdAt") * 1000000
      )::bigint::text AS "sessionCreatedAtEpochMicros",
      floor(
        extract(epoch FROM admin_user."passwordChangedAt") * 1000000
      )::bigint::text AS "passwordChangedAtEpochMicros",
      to_char(
        admin_session."createdAt" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "sessionCreatedAtText",
      to_char(
        admin_user."passwordChangedAt" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      ) AS "passwordChangedAtText"
    FROM "AdminSession" AS admin_session
    INNER JOIN "AdminUser" AS admin_user
      ON admin_user."id" = admin_session."userId"
    WHERE admin_session."tokenHash" = ${hashSessionToken(token)}
    LIMIT 1
  `;

  const authorization = getReadOnlyAdminSessionAuthorization(session ?? null, now);
  if (authorization === "invalid") return { kind: "unauthenticated" };
  if (authorization === "non-admin") return { kind: "non-admin" };

  const [identity] = await transaction.$queryRaw<
    {
      databaseName: string;
      currentUser: string;
      serverAddress: string | null;
      serverPort: number | null;
      transactionReadOnly: string;
    }[]
  >`
    SELECT
      current_database() AS "databaseName",
      current_user AS "currentUser",
      inet_server_addr()::text AS "serverAddress",
      inet_server_port() AS "serverPort",
      current_setting('transaction_read_only') AS "transactionReadOnly"
  `;

  if (!identity || identity.transactionReadOnly !== "on") {
    throw new Error("Database identity could not be verified read-only.");
  }

  return {
    kind: "admin",
    identity: {
      hostname,
      databaseName: identity.databaseName,
      serverPort: identity.serverPort,
      transactionReadOnly: true,
      branchIdentity: {
        status: "branch_identity_unavailable",
      },
    },
  };
}
