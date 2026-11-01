import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import {
  adminBlogTagSelect,
  deleteBlogTagWithAssociations,
  getBlogTaxonomyPrismaErrorCode,
  isBlogTaxonomyUniqueConflict,
  toAdminBlogTag,
} from "@/lib/blog-taxonomy-content";
import { isValidBlogTaxonomyId, parseBlogTagInput } from "@/lib/blog-taxonomy-validation";
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
    return adminContentResponse({ error: "Tag not found." }, 404);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseBlogTagInput(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid tag data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const tag = await prisma.tag.update({ where: { id }, data: parsed.data, select: adminBlogTagSelect });
    return adminContentResponse({ tag: toAdminBlogTag(tag) }, 200);
  } catch (error) {
    if (isBlogTaxonomyUniqueConflict(error)) {
      return adminContentResponse({ error: "A tag with this name or slug already exists." }, 409);
    }
    if (getBlogTaxonomyPrismaErrorCode(error) === "P2025") {
      return adminContentResponse({ error: "Tag not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to update the tag." }, 500);
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
    return adminContentResponse({ error: "Tag not found." }, 404);
  }

  try {
    const deleted = await prisma.$transaction((transaction) => deleteBlogTagWithAssociations(transaction, id));
    if (!deleted) return adminContentResponse({ error: "Tag not found." }, 404);
    return adminContentResponse({ success: true, removedAssociationCount: deleted.removedAssociationCount }, 200);
  } catch (error) {
    const code = getBlogTaxonomyPrismaErrorCode(error);
    if (code === "P2025") return adminContentResponse({ error: "Tag not found." }, 404);
    if (code === "P2003") {
      return adminContentResponse({ error: "Unable to delete this tag while posts are associated with it." }, 409);
    }
    return adminContentResponse({ error: "Unable to delete the tag." }, 500);
  }
}
