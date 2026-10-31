import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { createProjectCategorySlug, parseProjectCategoryInput } from "@/lib/project-category-validation";
import { PROJECT_CATEGORY_ID_PATTERN } from "@/lib/project-validation";

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
  _count: { select: { projects: true } },
} satisfies Prisma.ProjectCategorySelect;

function getPrismaErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}

function toCategoryResponse(category: Prisma.ProjectCategoryGetPayload<{ select: typeof categorySelect }>) {
  const { _count, ...details } = category;
  return { ...details, projectCount: _count.projects };
}

function categoryHasProjectsMessage(name: string, count: number): string {
  return `Cannot delete "${name}" because it contains ${count} ${count === 1 ? "project" : "projects"}. Reassign or remove them first.`;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!PROJECT_CATEGORY_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Category not found." }, 404);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseProjectCategoryInput(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid category data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  const slug = createProjectCategorySlug(parsed.data.name);
  if (!slug) {
    return adminContentResponse(
      {
        error: "Please correct the highlighted fields.",
        fields: { name: "Use a category name that can form a short URL slug." },
      },
      422,
    );
  }

  try {
    const category = await prisma.projectCategory.update({
      where: { id },
      data: { ...parsed.data, slug },
      select: categorySelect,
    });
    return adminContentResponse({ category: toCategoryResponse(category) }, 200);
  } catch (error) {
    const code = getPrismaErrorCode(error);
    if (code === "P2002") {
      return adminContentResponse(
        { error: "A project category with this name or generated URL already exists." },
        409,
      );
    }
    if (code === "P2025") {
      return adminContentResponse({ error: "Category not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to update the project category." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!PROJECT_CATEGORY_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Category not found." }, 404);
  }

  try {
    const result = await prisma.$transaction(async (transaction) => {
      // PostgreSQL project foreign-key checks take KEY SHARE locks, which conflict with this lock.
      // Holding it through the count and delete prevents a concurrent assignment from being nulled.
      const locked = await transaction.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name"
        FROM "ProjectCategory"
        WHERE "id" = ${id}::uuid
        FOR UPDATE
      `;
      const category = locked[0];
      if (!category) return { kind: "missing" as const };

      const projectCount = await transaction.project.count({ where: { categoryId: id } });
      if (projectCount > 0) {
        return { kind: "has-projects" as const, name: category.name, projectCount };
      }

      await transaction.projectCategory.delete({ where: { id } });
      return { kind: "deleted" as const };
    }, { isolationLevel: "ReadCommitted" });

    if (result.kind === "missing") {
      return adminContentResponse({ error: "Category not found." }, 404);
    }
    if (result.kind === "has-projects") {
      return adminContentResponse(
        { error: categoryHasProjectsMessage(result.name, result.projectCount) },
        409,
      );
    }

    return adminContentResponse({ success: true }, 200);
  } catch (error) {
    const code = getPrismaErrorCode(error);
    if (code === "P2025") {
      return adminContentResponse({ error: "Category not found." }, 404);
    }
    if (code === "P2003") {
      const category = await prisma.projectCategory.findUnique({
        where: { id },
        select: { name: true, _count: { select: { projects: true } } },
      }).catch(() => null);
      if (category && category._count.projects > 0) {
        return adminContentResponse(
          { error: categoryHasProjectsMessage(category.name, category._count.projects) },
          409,
        );
      }
      return adminContentResponse(
        { error: "Cannot delete this category while projects are assigned to it." },
        409,
      );
    }
    return adminContentResponse({ error: "Unable to delete the project category." }, 500);
  }
}
