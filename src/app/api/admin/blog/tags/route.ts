import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { adminBlogTagSelect, isBlogTaxonomyUniqueConflict, toAdminBlogTag } from "@/lib/blog-taxonomy-content";
import { parseBlogTagInput } from "@/lib/blog-taxonomy-validation";
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
    const tag = await prisma.tag.create({ data: parsed.data, select: adminBlogTagSelect });
    return adminContentResponse({ tag: toAdminBlogTag(tag) }, 201);
  } catch (error) {
    if (isBlogTaxonomyUniqueConflict(error)) {
      return adminContentResponse({ error: "A tag with this name or slug already exists." }, 409);
    }
    return adminContentResponse({ error: "Unable to create the tag." }, 500);
  }
}
