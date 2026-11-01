import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { adminBlogCategorySelect, isBlogTaxonomyUniqueConflict, toAdminBlogCategory } from "@/lib/blog-taxonomy-content";
import { parseBlogCategoryInput } from "@/lib/blog-taxonomy-validation";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";

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
    const category = await prisma.postCategory.create({
      data: parsed.data,
      select: adminBlogCategorySelect,
    });
    return adminContentResponse({ category: toAdminBlogCategory(category) }, 201);
  } catch (error) {
    if (isBlogTaxonomyUniqueConflict(error)) {
      return adminContentResponse({ error: "A category with this name or slug already exists." }, 409);
    }
    return adminContentResponse({ error: "Unable to create the category." }, 500);
  }
}
