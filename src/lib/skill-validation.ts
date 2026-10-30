import type { ContentStatus } from "@/generated/prisma/client";
import { isSkillIconName } from "@/lib/skill-icons";

export const SKILL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SkillField =
  | "name"
  | "categoryId"
  | "proficiencyLabel"
  | "description"
  | "icon"
  | "sortOrder"
  | "status";

export type SkillFieldErrors = Partial<Record<SkillField, string>>;

export interface SkillInputData {
  name?: string;
  categoryId?: string;
  proficiencyLabel?: string | null;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  status?: ContentStatus;
}

export interface ParsedInput<T> {
  data: T | null;
  errors: SkillFieldErrors;
  invalidShape?: boolean;
}

const SKILL_FIELDS = new Set<SkillField>([
  "name",
  "categoryId",
  "proficiencyLabel",
  "description",
  "icon",
  "sortOrder",
  "status",
]);
const CATEGORY_STATUSES = new Set<ContentStatus>(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const UUID_PATTERN = SKILL_ID_PATTERN;
const MAX_SORT_ORDER = 999_999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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

function parseOptionalText(
  value: unknown,
  field: "proficiencyLabel" | "description",
  maxLength: number,
  multiline: boolean,
  errors: SkillFieldErrors,
): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    errors[field] = "Enter text for this field.";
    return undefined;
  }

  const sanitized = multiline ? sanitizeMultiline(value) : sanitizeSingleLine(value);
  if (lengthInCharacters(sanitized) > maxLength) {
    errors[field] = `Use ${maxLength.toLocaleString()} characters or fewer.`;
    return undefined;
  }
  return sanitized || null;
}

function parseSkillFields(
  body: unknown,
  partial: boolean,
): ParsedInput<SkillInputData> {
  if (!isRecord(body) || Object.keys(body).some((key) => !SKILL_FIELDS.has(key as SkillField))) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const values = body;
  const errors: SkillFieldErrors = {};
  const data: SkillInputData = {};

  if (!partial || hasOwn(values, "name")) {
    const name = typeof values.name === "string" ? sanitizeSingleLine(values.name) : "";
    if (!name) {
      errors.name = "Skill name is required.";
    } else if (lengthInCharacters(name) > 120) {
      errors.name = "Use 120 characters or fewer.";
    } else {
      data.name = name;
    }
  }

  if (!partial || hasOwn(values, "categoryId")) {
    if (typeof values.categoryId !== "string" || !UUID_PATTERN.test(values.categoryId)) {
      errors.categoryId = "Choose a valid category.";
    } else {
      data.categoryId = values.categoryId;
    }
  }

  for (const field of ["proficiencyLabel", "description"] as const) {
    if (hasOwn(values, field)) {
      const parsed = parseOptionalText(
        values[field],
        field,
        field === "proficiencyLabel" ? 40 : 2_000,
        field === "description",
        errors,
      );
      if (parsed !== undefined) data[field] = parsed;
    } else if (!partial) {
      data[field] = null;
    }
  }

  if (hasOwn(values, "icon")) {
    const icon = values.icon;
    if (icon === null || icon === "") {
      data.icon = null;
    } else if (typeof icon === "string" && isSkillIconName(icon)) {
      data.icon = icon;
    } else {
      errors.icon = "Choose an icon from the available list.";
    }
  } else if (!partial) {
    data.icon = null;
  }

  if (hasOwn(values, "sortOrder")) {
    const sortOrder = values.sortOrder;
    if (
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > MAX_SORT_ORDER
    ) {
      errors.sortOrder = `Enter a whole number from 0 to ${MAX_SORT_ORDER.toLocaleString()}.`;
    } else {
      data.sortOrder = sortOrder;
    }
  }

  if (!partial || hasOwn(values, "status")) {
    const status = hasOwn(values, "status") ? values.status : partial ? undefined : "DRAFT";
    if (status === undefined && partial) {
      // Omitted PATCH fields remain unchanged.
    } else if (typeof status === "string" && CATEGORY_STATUSES.has(status as ContentStatus)) {
      data.status = status as ContentStatus;
    } else {
      errors.status = "Choose Draft, Published, or Archived.";
    }
  }

  if (partial && Object.keys(values).length === 0) {
    return { data: null, errors: {}, invalidShape: true };
  }

  return Object.keys(errors).length > 0
    ? { data: null, errors }
    : { data, errors };
}

export function parseCreateSkill(body: unknown): ParsedInput<SkillInputData> {
  return parseSkillFields(body, false);
}

export function parseUpdateSkill(body: unknown): ParsedInput<SkillInputData> {
  return parseSkillFields(body, true);
}

export interface CategoryInputData {
  name: string;
  description: string | null;
}

export function parseCreateSkillCategory(
  body: unknown,
): ParsedInput<CategoryInputData> {
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => key !== "name" && key !== "description")
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: SkillFieldErrors = {};
  const name = typeof body.name === "string" ? sanitizeSingleLine(body.name) : "";

  if (!name) {
    errors.name = "Category name is required.";
  } else if (lengthInCharacters(name) > 100) {
    errors.name = "Use 100 characters or fewer.";
  }

  const description = hasOwn(body, "description")
    ? parseOptionalText(body.description, "description", 500, true, errors)
    : null;

  if (description === undefined || Object.keys(errors).length > 0) {
    return { data: null, errors };
  }

  return { data: { name, description }, errors };
}

export function createCategorySlug(name: string): string | null {
  const slug = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug && slug.length <= 120 ? slug : null;
}
