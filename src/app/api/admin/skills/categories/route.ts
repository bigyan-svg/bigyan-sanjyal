import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentWrite, adminContentResponse } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { createCategorySlug, parseCreateSkillCategory } from "@/lib/skill-validation";

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
} satisfies Prisma.SkillCategorySelect;

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

  const parsed = parseCreateSkillCategory(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid category data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  const slug = createCategorySlug(parsed.data.name);
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
    const previous = await prisma.skillCategory.findFirst({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const category = await prisma.skillCategory.create({
      data: {
        ...parsed.data,
        slug,
        sortOrder: (previous?.sortOrder ?? -1) + 1,
      },
      select: categorySelect,
    });
    return adminContentResponse({ category }, 201);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return adminContentResponse(
        { error: "A category with this name or generated URL already exists." },
        409,
      );
    }
    return adminContentResponse({ error: "Unable to create the category." }, 500);
  }
}
