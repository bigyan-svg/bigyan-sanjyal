import { Prisma } from "../../src/generated/prisma/client";

export interface PreviewFirstAdminStore {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  adminUser: {
    count(args?: { where?: Record<string, never> }): Promise<number>;
    create(args: {
      data: {
        email: string;
        passwordHash: string;
        role: "ADMIN";
        isActive: true;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export class PreviewFirstAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewFirstAdminError";
  }
}

export const PREVIEW_ADMIN_ADVISORY_LOCK_NAMESPACE = 1112109145;
export const PREVIEW_ADMIN_ADVISORY_LOCK_ID = 1;
export const PREVIEW_ADMIN_ADVISORY_LOCK_QUERY =
  "SELECT pg_advisory_xact_lock($1::integer, $2::integer) IS NOT NULL AS locked";

export async function provisionFirstPreviewAdmin(
  transaction: PreviewFirstAdminStore,
  email: string,
  passwordHash: string,
): Promise<{ id: string }> {
  await transaction.$queryRawUnsafe(
    PREVIEW_ADMIN_ADVISORY_LOCK_QUERY,
    PREVIEW_ADMIN_ADVISORY_LOCK_NAMESPACE,
    PREVIEW_ADMIN_ADVISORY_LOCK_ID,
  );

  const accountCount = await transaction.adminUser.count();
  if (accountCount !== 0) {
    throw new PreviewFirstAdminError(
      "Preview first-admin provisioning is allowed only when no admin accounts exist.",
    );
  }

  return transaction.adminUser.create({
    data: {
      email,
      passwordHash,
      role: "ADMIN",
      isActive: true,
    },
    select: { id: true },
  });
}

export const PREVIEW_ADMIN_TRANSACTION_ISOLATION =
  Prisma.TransactionIsolationLevel.Serializable;
