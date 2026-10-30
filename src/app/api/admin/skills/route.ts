import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentWrite, adminContentResponse } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { parseCreateSkill } from "@/lib/skill-validation";

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

export async function POST(request: Request): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseCreateSkill(body);
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

    let sortOrder = parsed.data.sortOrder;
    if (sortOrder === undefined) {
      const aggregate = await prisma.skill.aggregate({
        where: { categoryId: category.id },
        _max: { sortOrder: true },
      });
      sortOrder = (aggregate._max.sortOrder ?? -1) + 1;
    }

    const status = parsed.data.status ?? "DRAFT";
    const skill = await prisma.skill.create({
      data: {
        name: parsed.data.name!,
        categoryId: category.id,
        proficiencyLabel: parsed.data.proficiencyLabel ?? null,
        description: parsed.data.description ?? null,
        icon: parsed.data.icon ?? null,
        sortOrder,
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
      select: skillSelect,
    });

    return adminContentResponse({ skill }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return adminContentResponse(
        { error: "A skill with this name already exists in that category." },
        409,
      );
    }
    return adminContentResponse({ error: "Unable to create the skill." }, 500);
  }
}
