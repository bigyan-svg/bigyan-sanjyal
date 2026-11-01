import type { Prisma } from "@/generated/prisma/client";

const publicBlogPostSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  publishedAt: true,
  category: { select: { name: true } },
  tags: {
    orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
    select: { tag: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PostSelect;

const publicBlogArticleSelect = {
  title: true,
  slug: true,
  excerpt: true,
  body: true,
  publishedAt: true,
  category: { select: { name: true } },
  tags: {
    orderBy: [{ tag: { name: "asc" } }, { tagId: "asc" }],
    select: { tag: { select: { id: true, name: true } } },
  },
} satisfies Prisma.PostSelect;

const publicBlogCategorySelect = {
  name: true,
  slug: true,
} satisfies Prisma.PostCategorySelect;

const publicBlogTagSelect = {
  name: true,
  slug: true,
} satisfies Prisma.TagSelect;

const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BLOG_CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BLOG_TAG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BLOG_SEARCH_MAX_LENGTH = 100;
const BLOG_PAGE_MAX = 100_000;

export const PUBLIC_BLOG_PAGE_SIZE = 9;

const publishedPostWhere = {
  status: "PUBLISHED",
  publishedAt: { not: null },
} satisfies Prisma.PostWhereInput;

export const publishedBlogPostQuery = {
  where: publishedPostWhere,
  orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  select: publicBlogPostSelect,
} satisfies Prisma.PostFindManyArgs;

export type PublicBlogPost = Prisma.PostGetPayload<{
  select: typeof publicBlogPostSelect;
}>;

export type PublicBlogCategory = Prisma.PostCategoryGetPayload<{
  select: typeof publicBlogCategorySelect;
}>;

export type PublicBlogTag = Prisma.TagGetPayload<{
  select: typeof publicBlogTagSelect;
}>;

type PublicBlogArticleRecord = Prisma.PostGetPayload<{
  select: typeof publicBlogArticleSelect;
}>;

export type PublicBlogArticle = Omit<PublicBlogArticleRecord, "publishedAt"> & {
  publishedAt: Date;
};

export function publishedBlogArticleQuery(slug: string) {
  return {
    where: { slug, ...publishedPostWhere },
    select: publicBlogArticleSelect,
  } satisfies Prisma.PostFindFirstArgs;
}

export const publishedBlogCategoriesQuery = {
  where: { posts: { some: publishedPostWhere } },
  orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { slug: "asc" }],
  select: publicBlogCategorySelect,
} satisfies Prisma.PostCategoryFindManyArgs;

export const publishedBlogTagsQuery = {
  where: { posts: { some: { post: { is: publishedPostWhere } } } },
  orderBy: [{ name: "asc" }, { slug: "asc" }],
  select: publicBlogTagSelect,
} satisfies Prisma.TagFindManyArgs;

type PublicBlogPostReader = (
  query: typeof publishedBlogPostQuery,
) => Promise<PublicBlogPost[]>;

export type PublishedBlogPostsResult =
  | { kind: "success"; posts: PublicBlogPost[] }
  | { kind: "unavailable" };

export async function readPublishedBlogPosts(
  readPosts: PublicBlogPostReader,
): Promise<PublishedBlogPostsResult> {
  try {
    const posts = await readPosts(publishedBlogPostQuery);
    return {
      kind: "success",
      posts: posts.filter(hasValidPublicationDate),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export interface BlogListingFilters {
  search: string;
  category: string;
  tag: string;
}

export type BlogListingSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedBlogListingParams extends BlogListingFilters {
  page: number;
}

function getSingleParameter(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function normalizeSearch(value: string | string[] | undefined): string {
  return Array.from(
    getSingleParameter(value).slice(0, BLOG_SEARCH_MAX_LENGTH * 4)
      .normalize("NFC")
      .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  ).slice(0, BLOG_SEARCH_MAX_LENGTH).join("");
}

function normalizeSlug(value: string | string[] | undefined, maxLength: number, pattern: RegExp): string {
  const rawSlug = getSingleParameter(value);
  if (rawSlug.length > maxLength + 32) return "";

  const slug = rawSlug.normalize("NFC").trim().toLowerCase();
  return slug.length <= maxLength && pattern.test(slug) ? slug : "";
}

function normalizePage(value: string | string[] | undefined): number {
  const rawPage = getSingleParameter(value);
  if (rawPage.length > 20) return 1;

  const page = rawPage.trim();
  if (!/^\d{1,9}$/u.test(page)) return 1;

  const parsed = Number(page);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= BLOG_PAGE_MAX ? parsed : 1;
}

export function normalizeBlogListingParams(
  searchParams: BlogListingSearchParams,
): ParsedBlogListingParams {
  return {
    search: normalizeSearch(searchParams.q),
    category: normalizeSlug(searchParams.category, 120, BLOG_CATEGORY_SLUG_PATTERN),
    tag: normalizeSlug(searchParams.tag, 100, BLOG_TAG_SLUG_PATTERN),
    page: normalizePage(searchParams.page),
  };
}

export function buildPublishedBlogPostWhere(
  filters: BlogListingFilters,
): Prisma.PostWhereInput {
  return {
    ...publishedPostWhere,
    ...(filters.search
      ? {
          OR: [
            { title: { contains: filters.search, mode: "insensitive" } },
            { excerpt: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.category ? { category: { is: { slug: filters.category } } } : {}),
    ...(filters.tag
      ? { tags: { some: { tag: { is: { slug: filters.tag } } } } }
      : {}),
  };
}

export function buildPublishedBlogListingQuery(filters: BlogListingFilters, page: number) {
  const safePage = Number.isSafeInteger(page) && page > 0 && page <= BLOG_PAGE_MAX ? page : 1;

  return {
    where: buildPublishedBlogPostWhere(filters),
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    skip: (safePage - 1) * PUBLIC_BLOG_PAGE_SIZE,
    take: PUBLIC_BLOG_PAGE_SIZE,
    select: publicBlogPostSelect,
  } satisfies Prisma.PostFindManyArgs;
}

export function buildBlogListingHref(filters: BlogListingFilters, page: number): string {
  const query = new URLSearchParams();
  if (filters.search) query.set("q", filters.search);
  if (filters.category) query.set("category", filters.category);
  if (filters.tag) query.set("tag", filters.tag);
  if (Number.isSafeInteger(page) && page > 1 && page <= BLOG_PAGE_MAX) {
    query.set("page", String(page));
  }

  const serialized = query.toString();
  return serialized ? `/blog?${serialized}` : "/blog";
}

export interface PublicBlogListingReader {
  findPosts(query: ReturnType<typeof buildPublishedBlogListingQuery>): Promise<PublicBlogPost[]>;
  countPosts(where: Prisma.PostWhereInput): Promise<number>;
  findCategories(query: typeof publishedBlogCategoriesQuery): Promise<PublicBlogCategory[]>;
  findTags(query: typeof publishedBlogTagsQuery): Promise<PublicBlogTag[]>;
}

export type PublicBlogListingResult =
  | {
      kind: "success";
      posts: PublicBlogPost[];
      categories: PublicBlogCategory[];
      tags: PublicBlogTag[];
      filters: BlogListingFilters;
      page: number;
      totalPages: number;
      totalCount: number;
    }
  | { kind: "unavailable" };

export async function readPublicBlogListing(
  searchParams: BlogListingSearchParams,
  reader: PublicBlogListingReader,
): Promise<PublicBlogListingResult> {
  try {
    const parsed = normalizeBlogListingParams(searchParams);
    const [categories, tags] = await Promise.all([
      reader.findCategories(publishedBlogCategoriesQuery),
      reader.findTags(publishedBlogTagsQuery),
    ]);
    const filters: BlogListingFilters = {
      search: parsed.search,
      category: categories.some(({ slug }) => slug === parsed.category) ? parsed.category : "",
      tag: tags.some(({ slug }) => slug === parsed.tag) ? parsed.tag : "",
    };
    const where = buildPublishedBlogPostWhere(filters);
    const totalCount = await reader.countPosts(where);
    const totalPages = Math.max(1, Math.ceil(totalCount / PUBLIC_BLOG_PAGE_SIZE));
    const page = Math.min(parsed.page, totalPages);
    const posts = totalCount > 0
      ? await reader.findPosts(buildPublishedBlogListingQuery(filters, page))
      : [];

    return {
      kind: "success",
      posts: posts.filter(hasValidPublicationDate),
      categories,
      tags,
      filters,
      page,
      totalPages,
      totalCount,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

type PublicBlogArticleReader = (
  query: ReturnType<typeof publishedBlogArticleQuery>,
) => Promise<PublicBlogArticleRecord | null>;

export type PublishedBlogArticleResult =
  | { kind: "success"; post: PublicBlogArticle }
  | { kind: "not-found" }
  | { kind: "unavailable" };

function hasValidPublicationDate<T extends { publishedAt: Date | null }>(
  post: T,
): post is T & { publishedAt: Date } {
  return post.publishedAt instanceof Date && Number.isFinite(post.publishedAt.getTime());
}

export async function readPublishedBlogPostBySlug(
  slug: string,
  readPost: PublicBlogArticleReader,
): Promise<PublishedBlogArticleResult> {
  if (!BLOG_SLUG_PATTERN.test(slug)) return { kind: "not-found" };

  try {
    const post = await readPost(publishedBlogArticleQuery(slug));
    if (!post || !hasValidPublicationDate(post)) return { kind: "not-found" };
    return { kind: "success", post };
  } catch {
    return { kind: "unavailable" };
  }
}

export function getPublishedBlogArticleMetadata(
  result: PublishedBlogArticleResult,
): { title: string; description: string } | null {
  if (result.kind !== "success") return null;

  const source = (result.post.excerpt?.trim() || result.post.body)
    .replace(/\s+/gu, " ")
    .trim();
  if (!source) return null;

  const characters = Array.from(source);
  const description = characters.length > 180
    ? `${characters.slice(0, 179).join("").trimEnd()}…`
    : source;

  return { title: result.post.title, description };
}

export function splitBlogBodyIntoParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/gu, "\n")
    .split(/\n[ \t]*\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
