import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import {
  adminBlogCategorySelect,
  deleteBlogCategoryWithPosts,
  getBlogTaxonomyPrismaErrorCode,
  isBlogTaxonomyUniqueConflict,
  toAdminBlogCategory,
} from "@/lib/blog-taxonomy-content";
import { isValidBlogTaxonomyId, parseBlogCategoryInput } from "@/lib/blog-taxonomy-validation";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!isValidBlogTaxonomyId(id)) {
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

  const parsed = parseBlogCategoryInput(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid category data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const category = await prisma.postCategory.update({
      where: { id },
      data: parsed.data,
      select: adminBlogCategorySelect,
    });
    return adminContentResponse({ category: toAdminBlogCategory(category) }, 200);
  } catch (error) {
    if (isBlogTaxonomyUniqueConflict(error)) {
      return adminContentResponse({ error: "A category with this name or slug already exists." }, 409);
    }
    if (getBlogTaxonomyPrismaErrorCode(error) === "P2025") {
      return adminContentResponse({ error: "Category not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to update the category." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!isValidBlogTaxonomyId(id)) {
    return adminContentResponse({ error: "Category not found." }, 404);
  }

  try {
    const deleted = await prisma.$transaction((transaction) => deleteBlogCategoryWithPosts(transaction, id));
    if (!deleted) return adminContentResponse({ error: "Category not found." }, 404);
    return adminContentResponse({ success: true, detachedPostCount: deleted.detachedPostCount }, 200);
  } catch (error) {
    const code = getBlogTaxonomyPrismaErrorCode(error);
    if (code === "P2025") return adminContentResponse({ error: "Category not found." }, 404);
    if (code === "P2003") {
      return adminContentResponse({ error: "Unable to delete this category while posts reference it." }, 409);
    }
    return adminContentResponse({ error: "Unable to delete the category." }, 500);
  }
}
