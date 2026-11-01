import type { Prisma } from "@/generated/prisma/client";

export const adminBlogCategorySelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  sortOrder: true,
  _count: { select: { posts: true } },
} satisfies Prisma.PostCategorySelect;

export const adminBlogTagSelect = {
  id: true,
  name: true,
  slug: true,
  _count: { select: { posts: true } },
} satisfies Prisma.TagSelect;

export type AdminBlogCategoryRecord = Prisma.PostCategoryGetPayload<{ select: typeof adminBlogCategorySelect }>;
export type AdminBlogTagRecord = Prisma.TagGetPayload<{ select: typeof adminBlogTagSelect }>;

export function toAdminBlogCategory(category: AdminBlogCategoryRecord) {
  const { _count, ...details } = category;
  return { ...details, postCount: _count.posts };
}

export function toAdminBlogTag(tag: AdminBlogTagRecord) {
  const { _count, ...details } = tag;
  return { ...details, postCount: _count.posts };
}

export function getBlogTaxonomyPrismaErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

export function isBlogTaxonomyUniqueConflict(error: unknown): boolean {
  return getBlogTaxonomyPrismaErrorCode(error) === "P2002";
}

export async function deleteBlogCategoryWithPosts(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<{ name: string; detachedPostCount: number } | null> {
  const locked = await transaction.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "PostCategory"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  const category = locked[0];
  if (!category) return null;

  const detachedPostCount = await transaction.post.count({ where: { categoryId: id } });
  await transaction.postCategory.delete({ where: { id } });
  return { name: category.name, detachedPostCount };
}

export async function deleteBlogTagWithAssociations(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<{ name: string; removedAssociationCount: number } | null> {
  const locked = await transaction.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "Tag"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  const tag = locked[0];
  if (!tag) return null;

  const removedAssociationCount = await transaction.postTag.count({ where: { tagId: id } });
  await transaction.tag.delete({ where: { id } });
  return { name: tag.name, removedAssociationCount };
}
