import type { Prisma } from "@/generated/prisma/client";

const publicExperienceSelect = {
  employer: true,
  roleTitle: true,
  location: true,
  description: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
} satisfies Prisma.WorkExperienceSelect;

const publishedExperienceWhere = {
  status: "PUBLISHED",
  publishedAt: { not: null },
} satisfies Prisma.WorkExperienceWhereInput;

export const publishedExperienceQuery = {
  where: publishedExperienceWhere,
  orderBy: [
    { sortOrder: "asc" },
    { startDate: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ],
  select: publicExperienceSelect,
} satisfies Prisma.WorkExperienceFindManyArgs;

export type PublicWorkExperience = Prisma.WorkExperienceGetPayload<{
  select: typeof publicExperienceSelect;
}>;

export type PublishedWorkExperienceResult =
  | { kind: "success"; experiences: PublicWorkExperience[] }
  | { kind: "unavailable" };

type PublicWorkExperienceReader = (
  query: typeof publishedExperienceQuery,
) => Promise<PublicWorkExperience[]>;

export async function readPublishedWorkExperiences(
  readExperiences: PublicWorkExperienceReader,
): Promise<PublishedWorkExperienceResult> {
  try {
    return {
      kind: "success",
      experiences: await readExperiences(publishedExperienceQuery),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
