import "server-only";

import type { Prisma } from "@/generated/prisma/client";

const publicEducationSelect = {
  institution: true,
  program: true,
  fieldOfStudy: true,
  description: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
} satisfies Prisma.EducationSelect;

const publishedEducationWhere = {
  status: "PUBLISHED",
  publishedAt: { not: null },
} satisfies Prisma.EducationWhereInput;

export const publishedEducationQuery = {
  where: publishedEducationWhere,
  orderBy: [
    { sortOrder: "asc" },
    { startDate: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ],
  select: publicEducationSelect,
} satisfies Prisma.EducationFindManyArgs;

export type PublicEducation = Prisma.EducationGetPayload<{
  select: typeof publicEducationSelect;
}>;

export type PublishedEducationResult =
  | { kind: "success"; education: PublicEducation[] }
  | { kind: "unavailable" };

type PublicEducationReader = (
  query: typeof publishedEducationQuery,
) => Promise<PublicEducation[]>;

export async function readPublishedEducation(
  readEducation: PublicEducationReader,
): Promise<PublishedEducationResult> {
  try {
    return {
      kind: "success",
      education: await readEducation(publishedEducationQuery),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
