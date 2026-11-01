import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import {
  adminBlogPostSelect,
  blogPostScalarData,
  BlogCategoryMissingError,
  BlogTagsMissingError,
  ensureBlogCategoryExists,
  getBlogPostPrismaErrorCode,
  isDuplicateBlogPostSlugError,
  replaceBlogPostTags,
  toAdminBlogPostItem,
} from "@/lib/blog-content";
import {
  BLOG_POST_ID_PATTERN,
  parseUpdateBlogPost,
  resolveBlogPostPublishedAt,
} from "@/lib/blog-validation";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";

const BLOG_POST_REQUEST_MAX_BYTES = 1024 * 1024;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!BLOG_POST_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Post not found." }, 404);
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request, BLOG_POST_REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseUpdateBlogPost(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid post data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }
  const postInput = parsed.data;

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const current = await transaction.post.findUnique({
        where: { id },
        select: { status: true, publishedAt: true },
      });
      if (!current) return { kind: "missing" as const };

      if (postInput.categoryId !== undefined) {
        await ensureBlogCategoryExists(transaction, postInput.categoryId);
      }
      if (postInput.tagIds !== undefined) {
        await replaceBlogPostTags(transaction, id, postInput.tagIds);
      }

      const nextStatus = postInput.status ?? current.status;
      await transaction.post.update({
        where: { id },
        data: {
          ...blogPostScalarData(postInput),
          status: nextStatus,
          publishedAt: resolveBlogPostPublishedAt(current.publishedAt, nextStatus),
        },
      });

      const post = await transaction.post.findUniqueOrThrow({
        where: { id },
        select: adminBlogPostSelect,
      });
      return { kind: "updated" as const, post };
    });

    if (result.kind === "missing") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    return adminContentResponse({ post: toAdminBlogPostItem(result.post) }, 200);
  } catch (error) {
    if (error instanceof BlogCategoryMissingError) {
      return adminContentResponse(
        { error: "Please correct the highlighted fields.", fields: { categoryId: "Choose an existing category." } },
        422,
      );
    }
    if (error instanceof BlogTagsMissingError) {
      return adminContentResponse(
        { error: "Please correct the highlighted fields.", fields: { tagIds: "Choose existing tags." } },
        422,
      );
    }
    const code = getBlogPostPrismaErrorCode(error);
    if (isDuplicateBlogPostSlugError(error)) {
      return adminContentResponse({ error: "A post with this slug already exists." }, 409);
    }
    if (code === "P2025") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    if (code === "P2003") {
      return adminContentResponse({ error: "The selected category or one of the selected tags no longer exists." }, 422);
    }
    return adminContentResponse({ error: "Unable to update the post." }, 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!BLOG_POST_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Post not found." }, 404);
  }

  try {
    await prisma.post.delete({ where: { id } });
    return adminContentResponse({ success: true }, 200);
  } catch (error) {
    if (getBlogPostPrismaErrorCode(error) === "P2025") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to delete the post." }, 500);
  }
}
