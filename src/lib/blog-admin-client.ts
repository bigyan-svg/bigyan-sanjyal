import type { AdminBlogPostItem, AdminBlogCategory, AdminBlogTag } from "@/lib/blog-types";
import { isAdminBlogPostResponse } from "@/lib/blog-form";
import { isAdminBlogCategory, isAdminBlogTag } from "@/lib/blog-taxonomy-client";

export interface AdminBlogDataSnapshot {
  posts: AdminBlogPostItem[];
  categories: AdminBlogCategory[];
  tags: AdminBlogTag[];
}

export type AdminBlogDataLoadResult =
  | { ok: true; data: AdminBlogDataSnapshot }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAdminBlogDataResponse(value: unknown): AdminBlogDataSnapshot | null {
  if (
    !isRecord(value) || !Array.isArray(value.posts) ||
    !Array.isArray(value.categories) || !Array.isArray(value.tags)
  ) return null;

  const posts = value.posts.map((post) => ({ post }));
  const categories = value.categories;
  const tags = value.tags;
  if (
    !posts.every(isAdminBlogPostResponse) ||
    !categories.every(isAdminBlogCategory) ||
    !tags.every(isAdminBlogTag)
  ) return null;

  return {
    posts: posts.map(({ post }) => post),
    categories,
    tags,
  };
}

export async function loadAdminBlogData(fetcher: typeof fetch = fetch): Promise<AdminBlogDataLoadResult> {
  try {
    const response = await fetcher("/api/admin/blog", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: "Unable to refresh Blog data. Please try again." };
    }

    const data = parseAdminBlogDataResponse(body);
    return data
      ? { ok: true, data }
      : { ok: false, error: "The server returned incomplete Blog data. Please try again." };
  } catch {
    return { ok: false, error: "Unable to refresh Blog data. Please try again." };
  }
}

/** Load and validate the complete snapshot before allowing callers to replace cached state. */
export async function loadAndAdoptAdminBlogData(
  adopt: (snapshot: AdminBlogDataSnapshot) => void,
  fetcher: typeof fetch = fetch,
): Promise<AdminBlogDataLoadResult> {
  const result = await loadAdminBlogData(fetcher);
  if (result.ok) adopt(result.data);
  return result;
}
