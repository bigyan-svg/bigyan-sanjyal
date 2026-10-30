import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentWrite, adminContentResponse } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { parseUpdateSkill, SKILL_ID_PATTERN } from "@/lib/skill-validation";

const skillSelect = {
  id: true,
  categoryId: true,
  name: true,
  icon: true,
  description: true,
  proficiencyLabel: true,
  status: true,
  sortOrder: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.SkillSelect;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!SKILL_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Skill not found." }, 404);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseUpdateSkill(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid skill data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const current = await prisma.skill.findUnique({
      where: { id },
      select: { id: true, categoryId: true, publishedAt: true },
    });
    if (!current) {
      return adminContentResponse({ error: "Skill not found." }, 404);
    }

    if (parsed.data.categoryId) {
      const category = await prisma.skillCategory.findUnique({
        where: { id: parsed.data.categoryId },
        select: { id: true },
      });
      if (!category) {
        return adminContentResponse(
          {
            error: "Please correct the highlighted fields.",
            fields: { categoryId: "Choose an existing category." },
          },
          422,
        );
      }
    }

    const data: Prisma.SkillUpdateInput = { ...parsed.data };
    if (parsed.data.status === "PUBLISHED" && current.publishedAt === null) {
      data.publishedAt = new Date();
    }

    const skill = await prisma.skill.update({
      where: { id },
      data,
      select: skillSelect,
    });
    return adminContentResponse({ skill }, 200);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return adminContentResponse(
        { error: "A skill with this name already exists in that category." },
        409,
      );
    }
    if (isRecordNotFoundError(error)) {
      return adminContentResponse({ error: "Skill not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to update the skill." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!SKILL_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Skill not found." }, 404);
  }

  try {
    await prisma.skill.delete({ where: { id } });
    return adminContentResponse({ success: true }, 200);
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      return adminContentResponse({ error: "Skill not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to delete the skill." }, 500);
  }
}
