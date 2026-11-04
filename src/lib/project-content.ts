import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { isSafePublicProjectUrl, type ProjectInputData } from "@/lib/project-validation";

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
  version: true,
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

export type AdminProjectRecord = Prisma.ProjectGetPayload<{
  select: typeof adminProjectSelect;
}>;

const projectAtomicUpdateSelect = {
  id: true,
  categoryId: true,
  title: true,
  slug: true,
  summary: true,
  description: true,
  status: true,
  featured: true,
  sortOrder: true,
  version: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

export type ProjectUpdateResult =
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "category-missing" }
  | { kind: "unsafe-public-media" }
  | { kind: "updated"; project: AdminProjectRecord };

export type ProjectDeleteOutcome =
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "deleted" };

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

export async function updateProjectInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  input: ProjectInputData,
  expectedVersion: number,
  now: Date,
): Promise<ProjectUpdateResult> {
  const current = await transaction.project.findUnique({
    where: { id },
    select: {
      version: true,
      publishedAt: true,
      links: { select: { url: true } },
      images: { select: { imageUrl: true } },
    },
  });
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  if (input.skillIds !== undefined && input.skillIds.length > 0) {
    const skillIds = [...input.skillIds].sort();
    const lockedSkills = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Skill"
      WHERE "id" IN (${Prisma.join(skillIds.map((skillId) => Prisma.sql`${skillId}::uuid`))})
      ORDER BY "id"
      FOR KEY SHARE
    `;
    if (lockedSkills.length !== skillIds.length) {
      const latest = await transaction.project.findUnique({ where: { id }, select: { version: true } });
      if (!latest) return { kind: "missing" };
      if (latest.version !== expectedVersion) return { kind: "conflict" };
      throw new ProjectSkillMissingError();
    }
  }

  if (
    input.status === "PUBLISHED" &&
    (
      (input.links ?? current.links).some((link) => !isSafePublicProjectUrl(link.url)) ||
      (input.images ?? current.images).some((image) => !isSafePublicProjectUrl(image.imageUrl))
    )
  ) {
    return { kind: "unsafe-public-media" };
  }

  if (input.categoryId) {
    const category = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ProjectCategory"
      WHERE "id" = ${input.categoryId}::uuid
      FOR KEY SHARE
    `;
    if (category.length === 0) return { kind: "category-missing" };
  }

  const updated = await transaction.project.updateManyAndReturn({
    where: { id, version: expectedVersion },
    data: {
      ...projectScalarData(input),
      version: { increment: 1 },
      // Preserve the established project publication behavior.
      publishedAt: input.status === "PUBLISHED" ? (current.publishedAt ?? now) : null,
    },
    select: projectAtomicUpdateSelect,
  });

  if (updated.length === 0) {
    const stillExists = await transaction.project.findUnique({
      where: { id },
      select: { id: true },
    });
    return stillExists ? { kind: "conflict" } : { kind: "missing" };
  }

  // All association writes share the transaction with the successful CAS.
  // They are intentionally skipped for a stale version.
  await syncProjectRelations(transaction, id, input);
  const relatedProject = await transaction.project.findUniqueOrThrow({
    where: { id },
    select: adminProjectSelect,
  });
  const project = { ...relatedProject, ...updated[0]! };
  return { kind: "updated", project };
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

/**
 * Locks the current row before classifying it, then deletes only the version
 * the caller originally loaded. The version remains part of the DELETE
 * predicate, so a read cannot turn into an unconditional delete.
 */
export async function deleteProjectWithVersion(
  transaction: Prisma.TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<ProjectDeleteOutcome> {
  const locked = await transaction.$queryRaw<Array<{ id: string; version: number }>>`
    SELECT "id", "version"
    FROM "Project"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  const deleted = await transaction.project.deleteMany({
    where: { id, version: expectedVersion },
  });
  if (deleted.count === 1) return { kind: "deleted" };

  // The row lock prevents a concurrent update or delete from changing this
  // record between the check and this version-qualified DELETE. Treat an
  // unexpected zero-row result as a safe conflict rather than deleting or
  // reporting a misleading successful outcome.
  return { kind: "conflict" };
}

export async function deleteSkillAndBumpProjectVersions(
  transaction: Prisma.TransactionClient,
  skillId: string,
): Promise<boolean> {
  const lockedSkill = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Skill"
    WHERE "id" = ${skillId}::uuid
    FOR UPDATE
  `;
  if (lockedSkill.length === 0) return false;

  const associations = await transaction.projectSkill.findMany({
    where: { skillId },
    select: { projectId: true },
  });
  const projectIds = [...new Set(associations.map(({ projectId }) => projectId))];
  if (projectIds.length > 0) {
    await transaction.project.updateMany({
      where: { id: { in: projectIds } },
      data: { version: { increment: 1 } },
    });
  }

  await transaction.skill.delete({ where: { id: skillId } });
  return true;
}
