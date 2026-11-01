import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { WorkExperienceUpdateResult } from "./work-experience-management";
import {
  prepareWorkExperienceUpdate,
  type WorkExperiencePatchData,
} from "./work-experience-validation";

export const workExperienceSelect = {
  id: true,
  employer: true,
  roleTitle: true,
  location: true,
  description: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  status: true,
  publishedAt: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkExperienceSelect;

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function updateWorkExperienceInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  patch: WorkExperiencePatchData,
  now: Date,
): Promise<WorkExperienceUpdateResult> {
  const current = await transaction.workExperience.findUnique({
    where: { id },
    select: workExperienceSelect,
  });
  if (!current) return { kind: "missing" };

  const prepared = prepareWorkExperienceUpdate(current, patch, now);
  if (!prepared.data) return { kind: "invalid", errors: prepared.errors };

  try {
    const experience = await transaction.workExperience.update({
      where: { id },
      data: prepared.data,
      select: workExperienceSelect,
    });
    return { kind: "updated", experience };
  } catch (error) {
    if (hasPrismaCode(error, "P2025")) return { kind: "missing" };
    throw error;
  }
}
