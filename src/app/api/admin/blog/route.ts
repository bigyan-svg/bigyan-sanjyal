import "server-only";

import { adminContentResponse, authorizeAdminContentRead, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import {
  adminBlogPostSelect,
  BlogCategoryMissingError,
  BlogTagsMissingError,
  ensureBlogCategoryExists,
  ensureBlogTagsExist,
  getBlogPostPrismaErrorCode,
  isDuplicateBlogPostSlugError,
  toAdminBlogPostItem,
} from "@/lib/blog-content";
import {
  adminBlogCategorySelect,
  adminBlogTagSelect,
  toAdminBlogCategory,
  toAdminBlogTag,
} from "@/lib/blog-taxonomy-content";
import { resolveBlogPostPublishedAt, parseCreateBlogPost } from "@/lib/blog-validation";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import { expectedVersionEntityTag } from "@/lib/optimistic-version";

const BLOG_POST_REQUEST_MAX_BYTES = 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const authorizationError = await authorizeAdminContentRead(request);
  if (authorizationError) return authorizationError;

  try {
    const [postRecords, categoryRecords, tagRecords] = await prisma.$transaction(
      async (transaction) => Promise.all([
        transaction.post.findMany({
          orderBy: [{ updatedAt: "desc" }, { title: "asc" }, { id: "asc" }],
          select: adminBlogPostSelect,
        }),
        transaction.postCategory.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: adminBlogCategorySelect,
        }),
        transaction.tag.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          select: adminBlogTagSelect,
        }),
      ]),
      { isolationLevel: "RepeatableRead" },
    );

    return adminContentResponse({
      posts: postRecords.map(toAdminBlogPostItem),
      categories: categoryRecords.map(toAdminBlogCategory),
      tags: tagRecords.map(toAdminBlogTag),
    }, 200);
  } catch {
    return adminContentResponse({ error: "Unable to load Blog data." }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  let body: unknown;
  try {
    body = await readJsonRequest(request, BLOG_POST_REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseCreateBlogPost(body);
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
    const post = await prisma.$transaction(async (transaction) => {
      await ensureBlogCategoryExists(transaction, postInput.categoryId ?? null);
      await ensureBlogTagsExist(transaction, postInput.tagIds ?? []);

      const created = await transaction.post.create({
        data: {
          title: postInput.title,
          slug: postInput.slug,
          excerpt: postInput.excerpt,
          body: postInput.body,
          categoryId: postInput.categoryId,
          status: postInput.status,
          publishedAt: resolveBlogPostPublishedAt(null, postInput.status),
        },
        select: { id: true },
      });

      if (postInput.tagIds.length > 0) {
        await transaction.postTag.createMany({
          data: postInput.tagIds.map((tagId) => ({ postId: created.id, tagId })),
        });
      }

      return transaction.post.findUniqueOrThrow({
        where: { id: created.id },
        select: adminBlogPostSelect,
      });
    });

    const postItem = toAdminBlogPostItem(post);
    return adminContentResponse(
      { post: postItem },
      201,
      { ETag: expectedVersionEntityTag(postItem.version) },
    );
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
    if (code === "P2003") {
      return adminContentResponse({ error: "The selected category or one of the selected tags no longer exists." }, 422);
    }
    return adminContentResponse({ error: "Unable to create the post." }, 500);
  }
}
