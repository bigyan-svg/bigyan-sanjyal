import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { createProjectCategorySlug, parseProjectCategoryInput } from "@/lib/project-category-validation";

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
    const category = await prisma.projectCategory.create({
      data: { ...parsed.data, slug },
      select: categorySelect,
    });
    return adminContentResponse({ category: toCategoryResponse(category) }, 201);
  } catch (error) {
    if (getPrismaErrorCode(error) === "P2002") {
      return adminContentResponse(
        { error: "A project category with this name or generated URL already exists." },
        409,
      );
    }
    return adminContentResponse({ error: "Unable to create the project category." }, 500);
  }
}
