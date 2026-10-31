import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentWrite, adminContentResponse } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { updateSkillCategory } from "@/lib/skill-category-update";
import { SKILL_CATEGORY_ID_PATTERN } from "@/lib/skill-validation";

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
} satisfies Prisma.SkillCategorySelect;

const CATEGORY_HAS_SKILLS_MESSAGE =
  "Remove or reassign this category's skills before deleting it.";

function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2003"
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  return updateSkillCategory(id, body, (categoryId, data) =>
    prisma.skillCategory.update({
      where: { id: categoryId },
      data,
      select: categorySelect,
    }),
  );
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!SKILL_CATEGORY_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Category not found." }, 404);
  }

  try {
    const deleted = await prisma.skillCategory.deleteMany({
      where: { id, skills: { none: {} } },
    });

    if (deleted.count === 1) {
      return adminContentResponse({ success: true }, 200);
    }

    const category = await prisma.skillCategory.findUnique({
      where: { id },
      select: { id: true, _count: { select: { skills: true } } },
    });

    if (!category) {
      return adminContentResponse({ error: "Category not found." }, 404);
    }

    if (category._count.skills > 0) {
      return adminContentResponse(
        { error: CATEGORY_HAS_SKILLS_MESSAGE },
        409,
      );
    }

    return adminContentResponse({ error: "Category not found." }, 404);
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return adminContentResponse({ error: CATEGORY_HAS_SKILLS_MESSAGE }, 409);
    }
    return adminContentResponse({ error: "Unable to delete the category." }, 500);
  }
}
