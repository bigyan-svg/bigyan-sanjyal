import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { EducationUpdateResult } from "./education-management";
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EducationSelect;

export const educationOrderBy = [
  { sortOrder: "asc" },
  { startDate: { sort: "desc", nulls: "last" } },
  { id: "asc" },
] satisfies Prisma.EducationOrderByWithRelationInput[];

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export async function updateEducationInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  patch: EducationPatchData,
  now: Date,
): Promise<EducationUpdateResult> {
  const current = await transaction.education.findUnique({
    where: { id },
    select: educationSelect,
  });
  if (!current) return { kind: "missing" };

  const prepared = prepareEducationUpdate(current, patch, now);
  if (!prepared.data) return { kind: "invalid", errors: prepared.errors };

  try {
    const education = await transaction.education.update({
      where: { id },
      data: prepared.data,
      select: educationSelect,
    });
    return { kind: "updated", education };
  } catch (error) {
    if (hasPrismaCode(error, "P2025")) return { kind: "missing" };
    throw error;
  }
}
