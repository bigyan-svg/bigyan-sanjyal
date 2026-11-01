import type { Prisma } from "@/generated/prisma/client";
import type { BlogPostInputData } from "@/lib/blog-validation";
import type { AdminBlogPostItem } from "@/lib/blog-types";

export const adminBlogPostSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  body: true,
  status: true,
  publishedAt: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  tags: {
    orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
    select: { tag: { select: { id: true, name: true } } },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PostSelect;

export type AdminBlogPostRecord = Prisma.PostGetPayload<{ select: typeof adminBlogPostSelect }>;

export function toAdminBlogPostItem(post: AdminBlogPostRecord): AdminBlogPostItem {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    categoryId: post.categoryId,
    category: post.category,
    tags: post.tags.map(({ tag }) => tag),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export class BlogCategoryMissingError extends Error {}
export class BlogTagsMissingError extends Error {}

export async function ensureBlogCategoryExists(
  transaction: Prisma.TransactionClient,
  categoryId: string | null,
): Promise<void> {
  if (categoryId === null) return;
  const category = await transaction.postCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) throw new BlogCategoryMissingError();
}

export async function ensureBlogTagsExist(
  transaction: Prisma.TransactionClient,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const tags = await transaction.tag.findMany({
    where: { id: { in: tagIds } },
    select: { id: true },
  });
  if (tags.length !== tagIds.length) throw new BlogTagsMissingError();
}

export async function replaceBlogPostTags(
  transaction: Prisma.TransactionClient,
  postId: string,
  tagIds: string[],
): Promise<void> {
  await ensureBlogTagsExist(transaction, tagIds);
  await transaction.postTag.deleteMany({ where: { postId } });
  if (tagIds.length > 0) {
    await transaction.postTag.createMany({
      data: tagIds.map((tagId) => ({ postId, tagId })),
    });
  }
}

export function blogPostScalarData(input: BlogPostInputData) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.slug !== undefined ? { slug: input.slug } : {}),
    ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

export function getBlogPostPrismaErrorCode(error: unknown): string | null {
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

export function isDuplicateBlogPostSlugError(error: unknown): boolean {
  return getBlogPostPrismaErrorCode(error) === "P2002";
}
