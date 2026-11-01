import type { ContentStatus } from "@/generated/prisma/client";
import { createProjectSlug } from "./project-validation";

export const BLOG_POST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const BLOG_POST_TITLE_MAX_LENGTH = 200;
export const BLOG_POST_SLUG_MAX_LENGTH = 180;
export const BLOG_POST_EXCERPT_MAX_LENGTH = 500;
export const BLOG_POST_BODY_MAX_LENGTH = 128_000;
export const BLOG_POST_TAGS_MAX_COUNT = 50;

export type BlogPostStatus = ContentStatus;
export type BlogPostField = "title" | "slug" | "excerpt" | "body" | "categoryId" | "tagIds" | "status";
export type BlogPostFieldErrors = Partial<Record<BlogPostField, string>>;

export interface BlogPostInputData {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  body?: string;
  categoryId?: string | null;
  tagIds?: string[];
  status?: BlogPostStatus;
}

export interface CreateBlogPostInputData extends BlogPostInputData {
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  categoryId: string | null;
  tagIds: string[];
  status: BlogPostStatus;
}

export interface ParsedBlogPostInput<T extends BlogPostInputData = BlogPostInputData> {
  data: T | null;
  errors: BlogPostFieldErrors;
  invalidShape?: boolean;
}

const BLOG_POST_FIELDS = new Set<BlogPostField>([
  "title",
  "slug",
  "excerpt",
  "body",
  "categoryId",
  "tagIds",
  "status",
]);
const BLOG_POST_STATUSES = new Set<BlogPostStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const BLOG_POST_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lengthInCharacters(value: string): number {
  return Array.from(value).length;
}

function sanitizeSingleLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function sanitizeMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .trim();
}

export function createBlogPostSlug(title: string): string {
  return createProjectSlug(title);
}

function parseTagIds(value: unknown, errors: BlogPostFieldErrors): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.tagIds = "Choose a valid list of tags.";
    return undefined;
  }
  if (value.length > BLOG_POST_TAGS_MAX_COUNT) {
    errors.tagIds = `Choose no more than ${BLOG_POST_TAGS_MAX_COUNT} tags.`;
    return undefined;
  }

  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !BLOG_POST_ID_PATTERN.test(id)) {
      errors.tagIds = "One or more selected tags are invalid.";
      return undefined;
    }
    if (ids.includes(id)) {
      errors.tagIds = "A tag can only be selected once.";
      return undefined;
    }
    ids.push(id);
  }
  return ids;
}

function parseBlogPostInput(body: unknown, isCreate: boolean): ParsedBlogPostInput {
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !BLOG_POST_FIELDS.has(key as BlogPostField)) ||
    (!isCreate && Object.keys(body).length === 0)
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: BlogPostFieldErrors = {};
  const data: BlogPostInputData = {};

  if (Object.hasOwn(body, "title") || isCreate) {
    const title = typeof body.title === "string" ? sanitizeSingleLine(body.title) : "";
    if (!title) errors.title = "Post title is required.";
    else if (lengthInCharacters(title) > BLOG_POST_TITLE_MAX_LENGTH) {
      errors.title = `Use ${BLOG_POST_TITLE_MAX_LENGTH} characters or fewer.`;
    } else data.title = title;
  }

  if (Object.hasOwn(body, "slug") || isCreate) {
    const slug = typeof body.slug === "string" ? sanitizeSingleLine(body.slug) : "";
    if (!slug) errors.slug = "Post slug is required.";
    else if (
      lengthInCharacters(slug) > BLOG_POST_SLUG_MAX_LENGTH ||
      !BLOG_POST_SLUG_PATTERN.test(slug)
    ) {
      errors.slug = "Use lowercase letters and numbers separated by single hyphens.";
    } else data.slug = slug;
  }

  if (Object.hasOwn(body, "excerpt")) {
    if (body.excerpt !== null && typeof body.excerpt !== "string") {
      errors.excerpt = "Enter text for this field.";
    } else {
      const excerpt = typeof body.excerpt === "string" ? sanitizeMultiline(body.excerpt) : "";
      if (lengthInCharacters(excerpt) > BLOG_POST_EXCERPT_MAX_LENGTH) {
        errors.excerpt = `Use ${BLOG_POST_EXCERPT_MAX_LENGTH} characters or fewer.`;
      } else data.excerpt = excerpt || null;
    }
  } else if (isCreate) {
    data.excerpt = null;
  }

  if (Object.hasOwn(body, "body") || isCreate) {
    const content = typeof body.body === "string" ? sanitizeMultiline(body.body) : "";
    if (!content) errors.body = "Post content is required.";
    else if (lengthInCharacters(content) > BLOG_POST_BODY_MAX_LENGTH) {
      errors.body = `Use ${BLOG_POST_BODY_MAX_LENGTH.toLocaleString()} characters or fewer.`;
    } else data.body = content;
  }

  if (Object.hasOwn(body, "categoryId")) {
    if (body.categoryId === null || body.categoryId === "") {
      data.categoryId = null;
    } else if (typeof body.categoryId !== "string" || !BLOG_POST_ID_PATTERN.test(body.categoryId)) {
      errors.categoryId = "Choose a valid category.";
    } else {
      data.categoryId = body.categoryId;
    }
  } else if (isCreate) {
    data.categoryId = null;
  }

  if (Object.hasOwn(body, "tagIds")) {
    const tagIds = parseTagIds(body.tagIds, errors);
    if (tagIds) data.tagIds = tagIds;
  } else if (isCreate) {
    data.tagIds = [];
  }

  if (Object.hasOwn(body, "status") || isCreate) {
    if (typeof body.status !== "string" || !BLOG_POST_STATUSES.has(body.status as BlogPostStatus)) {
      errors.status = "Choose Draft, Published, or Archived.";
    } else {
      data.status = body.status as BlogPostStatus;
    }
  }

  if (Object.keys(errors).length > 0) return { data: null, errors };
  return { data, errors };
}

export function parseCreateBlogPost(body: unknown): ParsedBlogPostInput<CreateBlogPostInputData> {
  const parsed = parseBlogPostInput(body, true);
  if (!parsed.data) {
    return { data: null, errors: parsed.errors, invalidShape: parsed.invalidShape };
  }
  return { ...parsed, data: parsed.data as CreateBlogPostInputData };
}

export function parseUpdateBlogPost(body: unknown): ParsedBlogPostInput {
  return parseBlogPostInput(body, false);
}

/** publishedAt records the original publication date and is retained across draft/archive transitions. */
export function resolveBlogPostPublishedAt(
  currentPublishedAt: Date | null,
  nextStatus: BlogPostStatus,
  now = new Date(),
): Date | null {
  if (currentPublishedAt) return currentPublishedAt;
  return nextStatus === "PUBLISHED" ? now : null;
}
