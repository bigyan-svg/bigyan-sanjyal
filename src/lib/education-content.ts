import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  EducationDeleteOutcome,
  EducationUpdateResult,
} from "./education-management";
import {
  prepareEducationUpdate,
  type EducationPatchData,
} from "./education-validation";

export const educationSelect = {
  id: true,
  institution: true,
  program: true,
  fieldOfStudy: true,
  description: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  status: true,
  publishedAt: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EducationSelect;

export const educationOrderBy = [
  { sortOrder: "asc" },
  { startDate: { sort: "desc", nulls: "last" } },
  { id: "asc" },
] satisfies Prisma.EducationOrderByWithRelationInput[];

export async function updateEducationInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  patch: EducationPatchData,
  expectedVersion: number,
  now: Date,
): Promise<EducationUpdateResult> {
  const current = await transaction.education.findUnique({
    where: { id },
    select: educationSelect,
  });
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  const prepared = prepareEducationUpdate(current, patch, now);
  if (!prepared.data) return { kind: "invalid", errors: prepared.errors };

  // The expected version came from the original client form, not this read.
  // Matching it and incrementing it in one UPDATE rejects stale browser forms
  // as well as overlapping transactions.
  const updated = await transaction.education.updateManyAndReturn({
    where: {
      id,
      version: expectedVersion,
    },
    data: {
      ...patch,
      version: { increment: 1 },
      ...(patch.status === "PUBLISHED" && current.publishedAt === null
        ? { publishedAt: now }
        : {}),
    },
    select: educationSelect,
  });

  if (updated.length === 0) {
    const stillExists = await transaction.education.findUnique({
      where: { id },
      select: { id: true },
    });
    return stillExists ? { kind: "conflict" } : { kind: "missing" };
  }

  // Return the exact row version produced by this atomic update. A follow-up
  // read could observe a later concurrent update and let a stale editor adopt
  // a version it never reconciled.
  return { kind: "updated", education: updated[0]! };
}

export async function deleteEducationWithVersion(
  transaction: Prisma.TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<EducationDeleteOutcome> {
  const locked = await transaction.$queryRaw<Array<{ id: string; version: number }>>`
    SELECT "id", "version"
    FROM "Education"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  const deleted = await transaction.education.deleteMany({
    where: { id, version: expectedVersion },
  });
  if (deleted.count === 1) return { kind: "deleted" };

  return { kind: "conflict" };
}
