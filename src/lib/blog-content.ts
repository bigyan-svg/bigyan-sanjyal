import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  resolveBlogPostPublishedAt,
  type BlogPostInputData,
} from "@/lib/blog-validation";
import type { AdminBlogPostItem } from "@/lib/blog-types";

export const adminBlogPostSelect = {
  id: true,
  version: true,
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

const blogPostAtomicUpdateSelect = {
  id: true,
  version: true,
  title: true,
  slug: true,
  excerpt: true,
  body: true,
  status: true,
  publishedAt: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PostSelect;

export type AdminBlogPostRecord = Prisma.PostGetPayload<{ select: typeof adminBlogPostSelect }>;

export type BlogPostUpdateResult =
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "updated"; post: AdminBlogPostRecord };

export type BlogPostDeleteOutcome =
  | { kind: "missing" }
  | { kind: "conflict" }
  | { kind: "deleted" };

export function toAdminBlogPostItem(post: AdminBlogPostRecord): AdminBlogPostItem {
  return {
    id: post.id,
    version: post.version,
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

async function lockBlogCategoryForUpdate(
  transaction: Prisma.TransactionClient,
  categoryId: string | null,
): Promise<void> {
  if (categoryId === null) return;
  const category = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PostCategory"
    WHERE "id" = ${categoryId}::uuid
    FOR KEY SHARE
  `;
  if (category.length === 0) throw new BlogCategoryMissingError();
}

async function lockBlogTagsForUpdate(
  transaction: Prisma.TransactionClient,
  tagIds: string[],
): Promise<void> {
  if (tagIds.length === 0) return;
  const sortedIds = [...tagIds].sort();
  const tags = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Tag"
    WHERE "id" IN (${Prisma.join(sortedIds.map((tagId) => Prisma.sql`${tagId}::uuid`))})
    ORDER BY "id"
    FOR KEY SHARE
  `;
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

export async function updateBlogPostInTransaction(
  transaction: Prisma.TransactionClient,
  id: string,
  input: BlogPostInputData,
  expectedVersion: number,
  now: Date,
): Promise<BlogPostUpdateResult> {
  const current = await transaction.post.findUnique({
    where: { id },
    select: { version: true, status: true, publishedAt: true },
  });
  if (!current) return { kind: "missing" };
  if (current.version !== expectedVersion) return { kind: "conflict" };

  try {
    if (input.categoryId !== undefined) {
      await lockBlogCategoryForUpdate(transaction, input.categoryId);
    }
    if (input.tagIds !== undefined) {
      await lockBlogTagsForUpdate(transaction, input.tagIds);
    }
  } catch (error) {
    if (!(error instanceof BlogCategoryMissingError) && !(error instanceof BlogTagsMissingError)) throw error;
    const latest = await transaction.post.findUnique({ where: { id }, select: { version: true } });
    if (!latest) return { kind: "missing" };
    if (latest.version !== expectedVersion) return { kind: "conflict" };
    throw error;
  }

  const nextStatus = input.status ?? current.status;
  const updated = await transaction.post.updateManyAndReturn({
    where: { id, version: expectedVersion },
    data: {
      ...blogPostScalarData(input),
      status: nextStatus,
      publishedAt: resolveBlogPostPublishedAt(current.publishedAt, nextStatus, now),
      version: { increment: 1 },
    },
    select: blogPostAtomicUpdateSelect,
  });

  if (updated.length === 0) {
    const stillExists = await transaction.post.findUnique({
      where: { id },
      select: { id: true },
    });
    return stillExists ? { kind: "conflict" } : { kind: "missing" };
  }

  // Association changes are committed only with the successful versioned row update.
  if (input.tagIds !== undefined) {
    await replaceBlogPostTags(transaction, id, input.tagIds);
  }

  const postWithTaxonomy = await transaction.post.findUniqueOrThrow({
    where: { id },
    select: adminBlogPostSelect,
  });
  const post = { ...postWithTaxonomy, ...updated[0]! };
  return { kind: "updated", post };
}

export async function deleteBlogPostWithVersion(
  transaction: Prisma.TransactionClient,
  id: string,
  expectedVersion: number,
): Promise<BlogPostDeleteOutcome> {
  const deleted = await transaction.post.deleteMany({
    where: { id, version: expectedVersion },
  });
  if (deleted.count === 1) return { kind: "deleted" };

  const existing = await transaction.post.findUnique({
    where: { id },
    select: { id: true },
  });
  return existing ? { kind: "conflict" } : { kind: "missing" };
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
