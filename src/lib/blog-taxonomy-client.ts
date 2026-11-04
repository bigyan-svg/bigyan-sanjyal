import type {
  AffectedBlogPostVersion,
  AdminBlogCategory,
  AdminBlogTag,
} from "@/lib/blog-types";
import { BLOG_POST_ID_PATTERN } from "@/lib/blog-validation";

export type BlogTaxonomyKind = "category" | "tag";

export type BlogTaxonomyDeleteResult =
  | { ok: true; count: number; affectedPosts: AffectedBlogPostVersion[] }
  | { ok: false; error: string; mutationMayHaveSucceeded?: boolean };

export type BlogTaxonomySaveResult =
  | { ok: true; category: AdminBlogCategory }
  | { ok: true; tag: AdminBlogTag }
  | { ok: false; error: string; fields: Record<string, string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDeleteResult(
  value: unknown,
  countKey: "detachedPostCount" | "removedAssociationCount",
): { count: number; affectedPosts: AffectedBlogPostVersion[] } | null {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.affectedPosts)) return null;
  const count = value[countKey];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;

  const affectedPosts: AffectedBlogPostVersion[] = [];
  const seenIds = new Set<string>();
  for (const item of value.affectedPosts) {
    if (
      !isRecord(item) || typeof item.id !== "string" || !BLOG_POST_ID_PATTERN.test(item.id) ||
      seenIds.has(item.id) ||
      typeof item.version !== "number" || !Number.isSafeInteger(item.version) || item.version < 1
    ) return null;
    seenIds.add(item.id);
    affectedPosts.push({ id: item.id, version: item.version });
  }
  // Each Post can have at most one association with a given taxonomy item.
  // The server count is therefore the exact number of affected Posts.
  if (affectedPosts.length !== count) return null;
  return { count, affectedPosts };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function responseError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function responseFields(value: unknown): Record<string, string> {
  if (!isRecord(value) || !isRecord(value.fields)) return {};
  return Object.fromEntries(
    Object.entries(value.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function isAdminBlogCategory(value: unknown): value is AdminBlogCategory {
  return isRecord(value) &&
    typeof value.id === "string" && BLOG_POST_ID_PATTERN.test(value.id) &&
    typeof value.name === "string" &&
    typeof value.slug === "string" &&
    (value.description === null || typeof value.description === "string") &&
    typeof value.sortOrder === "number" && Number.isSafeInteger(value.sortOrder) && value.sortOrder >= 0 &&
    typeof value.postCount === "number" && Number.isSafeInteger(value.postCount) && value.postCount >= 0;
}

export function isAdminBlogTag(value: unknown): value is AdminBlogTag {
  return isRecord(value) &&
    typeof value.id === "string" && BLOG_POST_ID_PATTERN.test(value.id) &&
    typeof value.name === "string" &&
    typeof value.slug === "string" &&
    typeof value.postCount === "number" && Number.isSafeInteger(value.postCount) && value.postCount >= 0;
}

export async function saveBlogTaxonomy(
  kind: BlogTaxonomyKind,
  id: string | null,
  payload: Record<string, string | number | null>,
  fetcher: typeof fetch = fetch,
): Promise<BlogTaxonomySaveResult> {
  const path = kind === "category" ? "categories" : "tags";
  const label = kind === "category" ? "category" : "tag";
  const fallback = `Unable to save the ${label}. Please try again.`;

  try {
    const response = await fetcher(`/api/admin/blog/${path}${id ? `/${id}` : ""}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const result = await readJson(response);
    if (!response.ok) {
      return { ok: false, error: responseError(result, fallback), fields: responseFields(result) };
    }

    if (
      kind === "category" && isRecord(result) && isAdminBlogCategory(result.category) &&
      (id === null || result.category.id === id)
    ) {
      return { ok: true, category: result.category };
    }
    if (
      kind === "tag" && isRecord(result) && isAdminBlogTag(result.tag) &&
      (id === null || result.tag.id === id)
    ) {
      return { ok: true, tag: result.tag };
    }
    return {
      ok: false,
      error: "The server returned an unexpected response. Please reload the page.",
      fields: {},
    };
  } catch {
    return { ok: false, error: fallback, fields: {} };
  }
}

export async function deleteBlogTaxonomy(
  kind: BlogTaxonomyKind,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<BlogTaxonomyDeleteResult> {
  const label = kind === "category" ? "category" : "tag";
  const fallback = `Unable to delete the ${label}. Please try again.`;

  try {
    const response = await fetcher(`/api/admin/blog/${kind === "category" ? "categories" : "tags"}/${id}`, {
      method: "DELETE",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) {
      return {
        ok: false,
        error: responseError(body, fallback),
        // A gateway/server error can be returned after the transaction commits.
        mutationMayHaveSucceeded: response.status === 408 || response.status >= 500,
      };
    }

    const deleted = readDeleteResult(
      body,
      kind === "category" ? "detachedPostCount" : "removedAssociationCount",
    );
    if (!deleted) {
      return {
        ok: false,
        error: "The server returned an unexpected deletion response.",
        mutationMayHaveSucceeded: true,
      };
    }

    return { ok: true, ...deleted };
  } catch {
    // The server may have committed the transaction before the connection
    // failed while returning the response. The caller must refresh authority.
    return { ok: false, error: fallback, mutationMayHaveSucceeded: true };
  }
}
