import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ProjectInputData } from "@/lib/project-validation";

export const adminProjectSelect = {
  id: true,
  categoryId: true,
  title: true,
  slug: true,
  summary: true,
  description: true,
  status: true,
  featured: true,
  sortOrder: true,
  category: { select: { id: true, name: true } },
  skills: {
    select: {
      skillId: true,
      skill: {
        select: {
          id: true,
          name: true,
          status: true,
          category: { select: { name: true } },
        },
      },
    },
  },
  links: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, type: true, label: true, url: true, sortOrder: true },
  },
  images: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, imageUrl: true, altText: true, caption: true, sortOrder: true },
  },
} satisfies Prisma.ProjectSelect;

export class ProjectSkillMissingError extends Error {
  constructor() {
    super("A selected skill no longer exists.");
    this.name = "ProjectSkillMissingError";
  }
}

export function projectScalarData(input: ProjectInputData) {
  return {
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    description: input.description,
    categoryId: input.categoryId,
    featured: input.featured,
    sortOrder: input.sortOrder,
    status: input.status,
  };
}

export async function syncProjectRelations(
  transaction: Prisma.TransactionClient,
  projectId: string,
  input: ProjectInputData,
): Promise<void> {
  if (input.skillIds !== undefined) {
    const skills = await transaction.skill.findMany({
      where: { id: { in: input.skillIds } },
      select: { id: true },
    });
    if (skills.length !== input.skillIds.length) throw new ProjectSkillMissingError();
  }

  if (input.skillIds !== undefined) {
    await transaction.projectSkill.deleteMany({ where: { projectId } });
    if (input.skillIds.length > 0) {
      await transaction.projectSkill.createMany({
        data: input.skillIds.map((skillId) => ({ projectId, skillId })),
      });
    }
  }

  if (input.links !== undefined) {
    await transaction.projectLink.deleteMany({ where: { projectId } });
    if (input.links.length > 0) {
      await transaction.projectLink.createMany({
        data: input.links.map((link) => ({ projectId, ...link })),
      });
    }
  }

  if (input.images !== undefined) {
    await transaction.projectImage.deleteMany({ where: { projectId } });
    if (input.images.length > 0) {
      await transaction.projectImage.createMany({
        data: input.images.map((image) => ({ projectId, ...image })),
      });
    }
  }
}
