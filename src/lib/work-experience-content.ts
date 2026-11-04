import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type {
  WorkExperienceDeleteOutcome,
  WorkExperienceUpdateResult,
} from "./work-experience-management";
import {
  prepareWorkExperienceUpdate,
  type WorkExperiencePatchData,
} from "./work-experience-validation";

export const workExperienceSelect = {
  id: true,
  employer: true,
  roleTitle: true,
  employmentType: true,
  location: true,
  description: true,
  startDate: true,
  endDate: true,
  currentPosition: true,
  status: true,
  publishedAt: true,
  sortOrder: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkExperienceSelect;

export async function updateWorkExperienceInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  patch: WorkExperiencePatchData,
  expectedVersion: number,
  now: Date,
): Promise<WorkExperienceUpdateResult> {
  const current = await transaction.workExperience.findUnique({
    where: { id },
    select: workExperienceSelect,
  });
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  const prepared = prepareWorkExperienceUpdate(current, patch, now);
  if (!prepared.data) return { kind: "invalid", errors: prepared.errors };

  // The expected version came from the original client form, not this read.
  // Matching it and incrementing it in one UPDATE rejects stale browser forms
  // as well as overlapping transactions.
  const updated = await transaction.workExperience.updateManyAndReturn({
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
    select: workExperienceSelect,
  });

  if (updated.length === 0) {
    const stillExists = await transaction.workExperience.findUnique({
      where: { id },
      select: { id: true },
    });
    return stillExists ? { kind: "conflict" } : { kind: "missing" };
  }

  // Return this write's row, so a later concurrent update cannot make the
  // caller advance its expected version without reconciling newer values.
  return { kind: "updated", experience: updated[0]! };
}

export async function deleteWorkExperienceWithVersion(
  transaction: Prisma.TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<WorkExperienceDeleteOutcome> {
  const locked = await transaction.$queryRaw<Array<{ id: string; version: number }>>`
    SELECT "id", "version"
    FROM "WorkExperience"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  const deleted = await transaction.workExperience.deleteMany({
    where: { id, version: expectedVersion },
  });
  if (deleted.count === 1) return { kind: "deleted" };

  return { kind: "conflict" };
}
