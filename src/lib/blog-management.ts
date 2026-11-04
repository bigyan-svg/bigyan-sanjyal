import "server-only";

import { adminContentResponse } from "@/lib/auth/admin-content-session";
import {
  BlogCategoryMissingError,
  BlogTagsMissingError,
  type BlogPostDeleteOutcome,
  getBlogPostPrismaErrorCode,
  isDuplicateBlogPostSlugError,
  toAdminBlogPostItem,
  type BlogPostUpdateResult,
} from "@/lib/blog-content";
import {
  BLOG_POST_ID_PATTERN,
  parseUpdateBlogPost,
} from "@/lib/blog-validation";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { expectedVersionEntityTag, parseExpectedVersion } from "@/lib/optimistic-version";

export const BLOG_POST_REQUEST_MAX_BYTES = 1024 * 1024;

export async function handleBlogPostUpdate(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    update(
      id: string,
      input: NonNullable<ReturnType<typeof parseUpdateBlogPost>["data"]>,
      expectedVersion: number,
      now: Date,
    ): Promise<BlogPostUpdateResult>;
    now?: () => Date;
  },
): Promise<Response> {
  const authorizationError = await dependencies.authorize(request);
  if (authorizationError) return authorizationError;

  if (!BLOG_POST_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Post not found." }, 404);
  }

  const expectedVersion = parseExpectedVersion(request.headers.get("If-Match"));
  if (expectedVersion === null) {
    return adminContentResponse(
      { error: "A valid expected version is required. Reload the post and try again." },
      400,
    );
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

  try {
    const result = await dependencies.update(
      id,
      parsed.data,
      expectedVersion,
      dependencies.now?.() ?? new Date(),
    );
    if (result.kind === "missing") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    if (result.kind === "conflict") {
      return adminContentResponse(
        { error: "This post changed since you opened it. Reload the latest version and reconcile your edits before saving again." },
        409,
      );
    }
    return adminContentResponse(
      { post: toAdminBlogPostItem(result.post) },
      200,
      { ETag: expectedVersionEntityTag(result.post.version) },
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
    if (code === "P2025") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    if (code === "P2003") {
      return adminContentResponse(
        { error: "The selected category or one of the selected tags no longer exists." },
        422,
      );
    }
    return adminContentResponse({ error: "Unable to update the post." }, 500);
  }
}

export async function handleBlogPostDelete(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    delete(id: string, expectedVersion: number): Promise<BlogPostDeleteOutcome>;
  },
): Promise<Response> {
  const authorizationError = await dependencies.authorize(request);
  if (authorizationError) return authorizationError;

  if (!BLOG_POST_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Post not found." }, 404);
  }

  const expectedVersion = parseExpectedVersion(request.headers.get("If-Match"));
  if (expectedVersion === null) {
    return adminContentResponse(
      { error: "A valid expected version is required. Reload the post and try again." },
      400,
    );
  }

  try {
    const result = await dependencies.delete(id, expectedVersion);
    if (result.kind === "missing") {
      return adminContentResponse({ error: "Post not found." }, 404);
    }
    if (result.kind === "conflict") {
      return adminContentResponse(
        { error: "This post changed since it was listed. Reload the latest Blog data before deleting it." },
        409,
      );
    }
    return adminContentResponse({ success: true }, 200);
  } catch {
    return adminContentResponse({ error: "Unable to delete the post." }, 500);
  }
}
