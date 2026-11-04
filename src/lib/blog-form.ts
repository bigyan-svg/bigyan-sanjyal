import type { AdminBlogPostItem } from "./blog-types";
import type { BlogPostFieldErrors, BlogPostInputData } from "./blog-validation";
import {
  BLOG_POST_BODY_MAX_LENGTH,
  BLOG_POST_EXCERPT_MAX_LENGTH,
  BLOG_POST_ID_PATTERN,
  BLOG_POST_SLUG_PATTERN,
  BLOG_POST_SLUG_MAX_LENGTH,
  BLOG_POST_TITLE_MAX_LENGTH,
} from "./blog-validation";
import { expectedVersionEntityTag } from "./optimistic-version";

export type BlogPostSaveResult =
  | { ok: true; post: AdminBlogPostItem }
  | { ok: false; error: string; fields: BlogPostFieldErrors };

export type BlogPostDeleteResult =
  | { ok: true }
  | { ok: false; error: string };

function readError(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  return fallback;
}

function readFields(value: unknown): BlogPostFieldErrors {
  if (
    typeof value === "object" && value !== null &&
    "fields" in value && typeof value.fields === "object" && value.fields !== null
  ) {
    return value.fields as BlogPostFieldErrors;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function withinCharacterLimit(value: string, maxLength: number): boolean {
  return Array.from(value).length <= maxLength;
}

function isAdminBlogRelation(value: unknown): value is { id: string; name: string } {
  return isRecord(value) &&
    typeof value.id === "string" && BLOG_POST_ID_PATTERN.test(value.id) &&
    typeof value.name === "string" && value.name.trim().length > 0;
}

/** Runtime validation for the complete serializer contract returned by the admin Blog APIs. */
export function isAdminBlogPostResponse(value: unknown): value is { post: AdminBlogPostItem } {
  if (!isRecord(value) || !isRecord(value.post)) return false;
  const post = value.post;
  if (
    typeof post.id !== "string" || !BLOG_POST_ID_PATTERN.test(post.id) ||
    typeof post.version !== "number" || !Number.isSafeInteger(post.version) || post.version < 1 ||
    typeof post.title !== "string" || post.title.trim().length === 0 || !withinCharacterLimit(post.title, BLOG_POST_TITLE_MAX_LENGTH) ||
    typeof post.slug !== "string" || !BLOG_POST_SLUG_PATTERN.test(post.slug) || !withinCharacterLimit(post.slug, BLOG_POST_SLUG_MAX_LENGTH) ||
    typeof post.body !== "string" || post.body.trim().length === 0 || !withinCharacterLimit(post.body, BLOG_POST_BODY_MAX_LENGTH) ||
    !(post.excerpt === null || (typeof post.excerpt === "string" && withinCharacterLimit(post.excerpt, BLOG_POST_EXCERPT_MAX_LENGTH))) ||
    !(post.status === "DRAFT" || post.status === "PUBLISHED" || post.status === "ARCHIVED") ||
    !(post.publishedAt === null || isIsoTimestamp(post.publishedAt)) ||
    !(post.categoryId === null || (typeof post.categoryId === "string" && BLOG_POST_ID_PATTERN.test(post.categoryId))) ||
    !(post.category === null || isAdminBlogRelation(post.category)) ||
    !Array.isArray(post.tags) ||
    !isIsoTimestamp(post.createdAt) ||
    !isIsoTimestamp(post.updatedAt)
  ) return false;

  if (post.status === "PUBLISHED" && post.publishedAt === null) return false;

  if (post.categoryId === null ? post.category !== null : !isAdminBlogRelation(post.category) || post.category.id !== post.categoryId) {
    return false;
  }

  const tagIds = new Set<string>();
  for (const tag of post.tags) {
    if (!isAdminBlogRelation(tag) || tagIds.has(tag.id)) return false;
    tagIds.add(tag.id);
  }

  return true;
}

export async function saveBlogPostRecord(
  post: Pick<AdminBlogPostItem, "id" | "version"> | null,
  payload: BlogPostInputData,
  fetcher: typeof fetch = fetch,
): Promise<BlogPostSaveResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (post) headers.set("If-Match", expectedVersionEntityTag(post.version));

  try {
    const response = await fetcher(
      post ? `/api/admin/blog/${post.id}` : "/api/admin/blog",
      {
        method: post ? "PATCH" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers,
        body: JSON.stringify(payload),
      },
    );
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = response.status === 409
        ? "This post changed since it was opened. Reload the latest version and reconcile your edits before saving again."
        : "Unable to save the post. Please try again.";
      return { ok: false, error: readError(result, fallback), fields: readFields(result) };
    }
    if (!isAdminBlogPostResponse(result)) {
      return {
        ok: false,
        error: "The post was saved, but its versioned details could not be loaded. Please reload the page.",
        fields: {},
      };
    }
    if (post && result.post.id !== post.id) {
      return {
        ok: false,
        error: "The post was saved, but its returned details did not match the post you edited. Please reload the page.",
        fields: {},
      };
    }
    return { ok: true, post: result.post };
  } catch {
    return {
      ok: false,
      error: "Unable to save the post. Please try again.",
      fields: {},
    };
  }
}

export async function deleteBlogPostRecord(
  post: Pick<AdminBlogPostItem, "id" | "version">,
  fetcher: typeof fetch = fetch,
): Promise<BlogPostDeleteResult> {
  try {
    const response = await fetcher(`/api/admin/blog/${post.id}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "If-Match": expectedVersionEntityTag(post.version) },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = response.status === 409
        ? "This post changed since it was listed. Reload the latest Blog data before deleting it."
        : "Unable to delete the post. Please try again.";
      return { ok: false, error: readError(body, fallback) };
    }
    if (!isRecord(body) || body.success !== true) {
      return { ok: false, error: "The post deletion response was incomplete. Reload the Blog page before continuing." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Unable to confirm the post deletion. Reload the Blog page before continuing." };
  }
}
