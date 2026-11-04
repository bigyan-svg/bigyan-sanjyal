import "server-only";

export class PasswordChangeSessionStateChangedError extends Error {}
export class PasswordRecoveryAccountStateChangedError extends Error {}

export type PasswordChangeExecuteRaw = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<number>;

export interface PasswordChangeTransactionInput {
  userId: string;
  sessionId: string;
  currentPasswordHash: string;
  newPasswordHash: string;
}

export async function updatePasswordAndRevokeSessions(
  executeRaw: PasswordChangeExecuteRaw,
  input: PasswordChangeTransactionInput,
): Promise<void> {
  const updatedUsers = await executeRaw`
    UPDATE "AdminUser" AS admin_user
    SET
      "passwordHash" = ${input.newPasswordHash},
      "passwordChangedAt" = clock_timestamp(),
      "updatedAt" = clock_timestamp()
    WHERE admin_user."id" = ${input.userId}
      AND admin_user."isActive" = TRUE
      AND admin_user."passwordHash" = ${input.currentPasswordHash}
      AND EXISTS (
        SELECT 1
        FROM "AdminSession" AS admin_session
        WHERE admin_session."id" = ${input.sessionId}
          AND admin_session."userId" = admin_user."id"
          AND admin_session."revokedAt" IS NULL
          AND admin_session."expiresAt" > clock_timestamp()
          AND admin_session."createdAt" > admin_user."passwordChangedAt"
      )
  `;

  if (updatedUsers !== 1) {
    throw new PasswordChangeSessionStateChangedError();
  }

  await executeRaw`
    UPDATE "AdminSession" AS admin_session
    SET "revokedAt" = clock_timestamp()
    WHERE admin_session."userId" = ${input.userId}
      AND admin_session."revokedAt" IS NULL
  `;
}

export interface PasswordRecoveryTransactionInput {
  userId: string;
  newPasswordHash: string;
}

/** Update an existing active ADMIN and revoke its sessions in the caller's transaction. */
export async function recoverAdminPasswordAndRevokeSessions(
  executeRaw: PasswordChangeExecuteRaw,
  input: PasswordRecoveryTransactionInput,
): Promise<void> {
  const updatedUsers = await executeRaw`
    UPDATE "AdminUser" AS admin_user
    SET
      "passwordHash" = ${input.newPasswordHash},
      "passwordChangedAt" = clock_timestamp(),
      "updatedAt" = clock_timestamp()
    WHERE admin_user."id" = ${input.userId}
      AND admin_user."role" = 'ADMIN'
      AND admin_user."isActive" = TRUE
  `;

  if (updatedUsers !== 1) {
    throw new PasswordRecoveryAccountStateChangedError();
  }

  await executeRaw`
    UPDATE "AdminSession" AS admin_session
    SET "revokedAt" = clock_timestamp()
    WHERE admin_session."userId" = ${input.userId}
      AND admin_session."revokedAt" IS NULL
  `;
}
