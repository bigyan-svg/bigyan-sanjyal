import { PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH, PROJECT_CATEGORY_NAME_MAX_LENGTH, PROJECT_CATEGORY_SORT_ORDER_MAX } from "@/lib/project-category-validation";
import { BLOG_POST_ID_PATTERN, createBlogPostSlug } from "@/lib/blog-validation";

export const BLOG_CATEGORY_SLUG_MAX_LENGTH = 120;
export const BLOG_TAG_NAME_MAX_LENGTH = 80;
export const BLOG_TAG_SLUG_MAX_LENGTH = 100;

export type BlogCategoryField = "name" | "slug" | "description" | "sortOrder";
export type BlogTagField = "name" | "slug";
export type BlogCategoryFieldErrors = Partial<Record<BlogCategoryField, string>>;
export type BlogTagFieldErrors = Partial<Record<BlogTagField, string>>;

export interface BlogCategoryInput {
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface BlogTagInput {
  name: string;
  slug: string;
}

export interface ParsedBlogCategoryInput {
  data: BlogCategoryInput | null;
  errors: BlogCategoryFieldErrors;
  invalidShape?: boolean;
}

export interface ParsedBlogTagInput {
  data: BlogTagInput | null;
  errors: BlogTagFieldErrors;
  invalidShape?: boolean;
}

const BLOG_CATEGORY_FIELDS = new Set<BlogCategoryField>(["name", "slug", "description", "sortOrder"]);
const BLOG_TAG_FIELDS = new Set<BlogTagField>(["name", "slug"]);
const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

export function createBlogCategorySlug(name: string): string {
  const slug = createBlogPostSlug(name);
  return slug.length <= BLOG_CATEGORY_SLUG_MAX_LENGTH ? slug : "";
}

export function createBlogTagSlug(name: string): string {
  const slug = createBlogPostSlug(name);
  return slug.length <= BLOG_TAG_SLUG_MAX_LENGTH ? slug : "";
}

function parseName(value: unknown, maxLength: number, label: string): { value?: string; error?: string } {
  const name = typeof value === "string" ? sanitizeSingleLine(value) : "";
  if (!name) return { error: `${label} name is required.` };
  if (lengthInCharacters(name) > maxLength) {
    return { error: `Use ${maxLength} characters or fewer.` };
  }
  return { value: name };
}

function parseSlug(value: unknown, maxLength: number): { value?: string; error?: string } {
  const slug = typeof value === "string" ? sanitizeSingleLine(value) : "";
  if (!slug) return { error: "Slug is required." };
  if (lengthInCharacters(slug) > maxLength || !BLOG_SLUG_PATTERN.test(slug)) {
    return { error: "Use lowercase letters and numbers separated by single hyphens." };
  }
  return { value: slug };
}

export function parseBlogCategoryInput(body: unknown): ParsedBlogCategoryInput {
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !BLOG_CATEGORY_FIELDS.has(key as BlogCategoryField))
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: BlogCategoryFieldErrors = {};
  const parsedName = parseName(body.name, PROJECT_CATEGORY_NAME_MAX_LENGTH, "Category");
  const parsedSlug = parseSlug(body.slug, BLOG_CATEGORY_SLUG_MAX_LENGTH);
  if (parsedName.error) errors.name = parsedName.error;
  if (parsedSlug.error) errors.slug = parsedSlug.error;

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") {
      errors.description = "Enter text for this field.";
    } else {
      description = sanitizeMultiline(body.description) || null;
      if (description && lengthInCharacters(description) > PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH) {
        errors.description = `Use ${PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
      }
    }
  }

  const sortOrder = body.sortOrder;
  if (
    typeof sortOrder !== "number" ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > PROJECT_CATEGORY_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${PROJECT_CATEGORY_SORT_ORDER_MAX.toLocaleString()}.`;
  }

  if (Object.keys(errors).length > 0) return { data: null, errors };
  return {
    data: {
      name: parsedName.value as string,
      slug: parsedSlug.value as string,
      description,
      sortOrder: sortOrder as number,
    },
    errors,
  };
}

export function parseBlogTagInput(body: unknown): ParsedBlogTagInput {
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !BLOG_TAG_FIELDS.has(key as BlogTagField))
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: BlogTagFieldErrors = {};
  const parsedName = parseName(body.name, BLOG_TAG_NAME_MAX_LENGTH, "Tag");
  const parsedSlug = parseSlug(body.slug, BLOG_TAG_SLUG_MAX_LENGTH);
  if (parsedName.error) errors.name = parsedName.error;
  if (parsedSlug.error) errors.slug = parsedSlug.error;
  if (Object.keys(errors).length > 0) return { data: null, errors };

  return {
    data: { name: parsedName.value as string, slug: parsedSlug.value as string },
    errors,
  };
}

export function isValidBlogTaxonomyId(id: string): boolean {
  return BLOG_POST_ID_PATTERN.test(id);
}
