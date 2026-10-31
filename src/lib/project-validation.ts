import type { ContentStatus, ProjectLinkType } from "@/generated/prisma/client";

export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const PROJECT_CATEGORY_ID_PATTERN = PROJECT_ID_PATTERN;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 5_000;
export const PROJECT_SORT_ORDER_MAX = 999_999;
export const PROJECT_LINK_LABEL_MAX_LENGTH = 80;
export const PROJECT_LINK_URL_MAX_LENGTH = 2_048;
export const PROJECT_LINKS_MAX_COUNT = 20;
export const PROJECT_IMAGES_MAX_COUNT = 20;
export const PROJECT_IMAGE_ALT_MAX_LENGTH = 300;
export const PROJECT_IMAGE_CAPTION_MAX_LENGTH = 500;
export const PROJECT_IMAGE_URL_MAX_LENGTH = 2_048;
export const PROJECT_SKILLS_MAX_COUNT = 100;

export const PROJECT_LINK_TYPES = [
  "GITHUB_REPOSITORY",
  "LIVE_DEMO",
  "DOCUMENTATION",
  "OTHER",
] as const satisfies readonly ProjectLinkType[];

export type ProjectStatus = Extract<ContentStatus, "DRAFT" | "PUBLISHED" | "ARCHIVED">;
export type ProjectField =
  | "title"
  | "slug"
  | "summary"
  | "description"
  | "categoryId"
  | "featured"
  | "sortOrder"
  | "status"
  | "skillIds"
  | "links"
  | "images";

export type ProjectFieldErrors = Partial<Record<ProjectField, string>>;

export interface ProjectLinkInput {
  type: ProjectLinkType;
  label: string;
  url: string;
  sortOrder: number;
}

export interface ProjectImageInput {
  imageUrl: string;
  altText: string;
  caption: string | null;
  sortOrder: number;
}

export interface ProjectInputData {
  title: string;
  slug: string;
  summary: string;
  description: string | null;
  categoryId: string | null;
  featured: boolean;
  sortOrder: number;
  status: ProjectStatus;
  skillIds?: string[];
  links?: ProjectLinkInput[];
  images?: ProjectImageInput[];
}

export interface ParsedProjectInput {
  data: ProjectInputData | null;
  errors: ProjectFieldErrors;
  invalidShape?: boolean;
}

const PROJECT_FIELDS = new Set<ProjectField>([
  "title",
  "slug",
  "summary",
  "description",
  "categoryId",
  "featured",
  "sortOrder",
  "status",
  "skillIds",
  "links",
  "images",
]);
const PROJECT_STATUSES = new Set<ProjectStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const PROJECT_LINK_TYPE_SET = new Set<string>(PROJECT_LINK_TYPES);
const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PROJECT_LINK_FIELDS = new Set(["type", "label", "url", "sortOrder"]);
const PROJECT_IMAGE_FIELDS = new Set(["imageUrl", "altText", "caption", "sortOrder"]);

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

export function createProjectSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
}

function normalizeProjectUrl(value: unknown, allowLocalHttp: boolean): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > PROJECT_LINK_URL_MAX_LENGTH) return null;

  try {
    const url = new URL(candidate);
    if (!url.hostname || url.username || url.password) return null;
    if (url.protocol === "https:") return url.href;
    if (allowLocalHttp && url.protocol === "http:" && isLocalDevelopmentHost(url.hostname)) {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function isSafePublicProjectUrl(value: string): boolean {
  return normalizeProjectUrl(value, false) !== null;
}

function parseSkillIds(value: unknown, errors: ProjectFieldErrors): string[] | undefined {
  if (!Array.isArray(value)) {
    errors.skillIds = "Choose a valid list of existing skills.";
    return undefined;
  }
  if (value.length > PROJECT_SKILLS_MAX_COUNT) {
    errors.skillIds = `Choose no more than ${PROJECT_SKILLS_MAX_COUNT} skills.`;
    return undefined;
  }

  const skillIds: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !PROJECT_ID_PATTERN.test(id)) {
      errors.skillIds = "One or more selected skills are invalid.";
      return undefined;
    }
    if (skillIds.includes(id)) {
      errors.skillIds = "A skill can only be selected once.";
      return undefined;
    }
    skillIds.push(id);
  }
  return skillIds;
}

function parseLinks(
  value: unknown,
  status: ProjectStatus,
  errors: ProjectFieldErrors,
): ProjectLinkInput[] | undefined {
  if (!Array.isArray(value)) {
    errors.links = "Enter a valid list of project links.";
    return undefined;
  }
  if (value.length > PROJECT_LINKS_MAX_COUNT) {
    errors.links = `Add no more than ${PROJECT_LINKS_MAX_COUNT} project links.`;
    return undefined;
  }

  const links: ProjectLinkInput[] = [];
  const seenUrls = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || Object.keys(item).some((key) => !PROJECT_LINK_FIELDS.has(key))) {
      errors.links = `Link ${index + 1} contains unsupported fields.`;
      return undefined;
    }

    const label = typeof item.label === "string" ? sanitizeSingleLine(item.label) : "";
    if (!label || lengthInCharacters(label) > PROJECT_LINK_LABEL_MAX_LENGTH) {
      errors.links = `Link ${index + 1} needs a label of ${PROJECT_LINK_LABEL_MAX_LENGTH} characters or fewer.`;
      return undefined;
    }

    if (typeof item.type !== "string" || !PROJECT_LINK_TYPE_SET.has(item.type)) {
      errors.links = `Choose a valid type for link ${index + 1}.`;
      return undefined;
    }

    const url = normalizeProjectUrl(item.url, status === "DRAFT");
    if (!url) {
      errors.links = status === "DRAFT"
        ? `Link ${index + 1} must use HTTPS. HTTP is allowed only for localhost development links on draft projects.`
        : `Link ${index + 1} must use a valid HTTPS URL.`;
      return undefined;
    }
    if (seenUrls.has(url)) {
      errors.links = `Link ${index + 1} duplicates another project link.`;
      return undefined;
    }
    seenUrls.add(url);

    const sortOrder = item.sortOrder;
    if (
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > PROJECT_SORT_ORDER_MAX
    ) {
      errors.links = `Link ${index + 1} has an invalid display order.`;
      return undefined;
    }

    links.push({ type: item.type as ProjectLinkType, label, url, sortOrder });
  }
  return links;
}

function parseImages(value: unknown, errors: ProjectFieldErrors): ProjectImageInput[] | undefined {
  if (!Array.isArray(value)) {
    errors.images = "Enter a valid list of project images.";
    return undefined;
  }
  if (value.length > PROJECT_IMAGES_MAX_COUNT) {
    errors.images = `Add no more than ${PROJECT_IMAGES_MAX_COUNT} project images.`;
    return undefined;
  }

  const images: ProjectImageInput[] = [];
  const seenUrls = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || Object.keys(item).some((key) => !PROJECT_IMAGE_FIELDS.has(key))) {
      errors.images = `Image ${index + 1} contains unsupported fields.`;
      return undefined;
    }

    const imageUrl = normalizeProjectUrl(item.imageUrl, false);
    if (!imageUrl || imageUrl.length > PROJECT_IMAGE_URL_MAX_LENGTH) {
      errors.images = `Image ${index + 1} must use a valid HTTPS URL without embedded credentials.`;
      return undefined;
    }
    if (seenUrls.has(imageUrl)) {
      errors.images = `Image ${index + 1} duplicates another project image.`;
      return undefined;
    }
    seenUrls.add(imageUrl);

    const altText = typeof item.altText === "string" ? sanitizeSingleLine(item.altText) : "";
    if (!altText || lengthInCharacters(altText) > PROJECT_IMAGE_ALT_MAX_LENGTH) {
      errors.images = `Image ${index + 1} needs alternative text of ${PROJECT_IMAGE_ALT_MAX_LENGTH} characters or fewer.`;
      return undefined;
    }

    let caption: string | null = null;
    if (item.caption !== undefined && item.caption !== null) {
      if (typeof item.caption !== "string") {
        errors.images = `Image ${index + 1} has an invalid caption.`;
        return undefined;
      }
      caption = sanitizeMultiline(item.caption) || null;
      if (caption && lengthInCharacters(caption) > PROJECT_IMAGE_CAPTION_MAX_LENGTH) {
        errors.images = `Image ${index + 1} captions must be ${PROJECT_IMAGE_CAPTION_MAX_LENGTH} characters or fewer.`;
        return undefined;
      }
    }

    const sortOrder = item.sortOrder;
    if (
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > PROJECT_SORT_ORDER_MAX
    ) {
      errors.images = `Image ${index + 1} has an invalid display order.`;
      return undefined;
    }

    images.push({ imageUrl, altText, caption, sortOrder });
  }
  return images;
}

export function parseProjectInput(body: unknown): ParsedProjectInput {
  if (!isRecord(body) || Object.keys(body).some((key) => !PROJECT_FIELDS.has(key as ProjectField))) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: ProjectFieldErrors = {};
  const title = typeof body.title === "string" ? sanitizeSingleLine(body.title) : "";
  const slug = typeof body.slug === "string" ? sanitizeSingleLine(body.slug) : "";
  const summary = typeof body.summary === "string" ? sanitizeSingleLine(body.summary) : "";

  if (!title) {
    errors.title = "Project title is required.";
  } else if (lengthInCharacters(title) > 200) {
    errors.title = "Use 200 characters or fewer.";
  }

  if (!slug) {
    errors.slug = "Project slug is required.";
  } else if (lengthInCharacters(slug) > 180 || !PROJECT_SLUG_PATTERN.test(slug)) {
    errors.slug = "Use lowercase letters and numbers separated by single hyphens.";
  }

  if (!summary) {
    errors.summary = "Project summary is required.";
  } else if (lengthInCharacters(summary) > 400) {
    errors.summary = "Use 400 characters or fewer.";
  }

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") {
      errors.description = "Enter text for this field.";
    } else {
      description = sanitizeMultiline(body.description) || null;
      if (description && lengthInCharacters(description) > PROJECT_DESCRIPTION_MAX_LENGTH) {
        errors.description = `Use ${PROJECT_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`;
      }
    }
  }

  let categoryId: string | null = null;
  if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== "") {
    if (typeof body.categoryId !== "string" || !PROJECT_CATEGORY_ID_PATTERN.test(body.categoryId)) {
      errors.categoryId = "Choose a valid category.";
    } else {
      categoryId = body.categoryId;
    }
  }

  if (typeof body.featured !== "boolean") {
    errors.featured = "Choose whether this project is featured.";
  }

  const sortOrder = body.sortOrder;
  if (
    typeof sortOrder !== "number" ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > PROJECT_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${PROJECT_SORT_ORDER_MAX.toLocaleString()}.`;
  }

  const status = body.status;
  const validStatus = typeof status === "string" && PROJECT_STATUSES.has(status as ProjectStatus)
    ? status as ProjectStatus
    : null;
  if (!validStatus) errors.status = "Choose Draft, Published, or Archived.";

  let skillIds: string[] | undefined;
  if (Object.hasOwn(body, "skillIds")) skillIds = parseSkillIds(body.skillIds, errors);

  let links: ProjectLinkInput[] | undefined;
  if (Object.hasOwn(body, "links")) links = parseLinks(body.links, validStatus ?? "PUBLISHED", errors);

  let images: ProjectImageInput[] | undefined;
  if (Object.hasOwn(body, "images")) images = parseImages(body.images, errors);

  if (Object.keys(errors).length > 0) {
    return { data: null, errors };
  }

  const data: ProjectInputData = {
    title,
    slug,
    summary,
    description,
    categoryId,
    featured: body.featured as boolean,
    sortOrder: sortOrder as number,
    status: validStatus as ProjectStatus,
  };
  if (skillIds !== undefined) data.skillIds = skillIds;
  if (links !== undefined) data.links = links;
  if (images !== undefined) data.images = images;

  return { data, errors };
}
