export const PROJECT_CATEGORY_NAME_MAX_LENGTH = 100;
export const PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH = 500;
export const PROJECT_CATEGORY_SORT_ORDER_MAX = 999_999;

export type ProjectCategoryField = "name" | "description" | "sortOrder";
export type ProjectCategoryFieldErrors = Partial<Record<ProjectCategoryField, string>>;

export interface ProjectCategoryInput {
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface ParsedProjectCategoryInput {
  data: ProjectCategoryInput | null;
  errors: ProjectCategoryFieldErrors;
  invalidShape?: boolean;
}

const PROJECT_CATEGORY_FIELDS = new Set<ProjectCategoryField>([
  "name",
  "description",
  "sortOrder",
]);

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

export function createProjectCategorySlug(value: string): string | null {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return slug && slug.length <= 120 ? slug : null;
}

export function parseProjectCategoryInput(body: unknown): ParsedProjectCategoryInput {
  if (
    !isRecord(body) ||
    Object.keys(body).some((key) => !PROJECT_CATEGORY_FIELDS.has(key as ProjectCategoryField))
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: ProjectCategoryFieldErrors = {};
  const name = typeof body.name === "string" ? sanitizeSingleLine(body.name) : "";

  if (!name) {
    errors.name = "Category name is required.";
  } else if (lengthInCharacters(name) > PROJECT_CATEGORY_NAME_MAX_LENGTH) {
    errors.name = `Use ${PROJECT_CATEGORY_NAME_MAX_LENGTH} characters or fewer.`;
  }

  let description: string | null = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== "string") {
      errors.description = "Enter text for this field.";
    } else {
      description = sanitizeMultiline(body.description) || null;
      if (
        description &&
        lengthInCharacters(description) > PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH
      ) {
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

  if (Object.keys(errors).length > 0) {
    return { data: null, errors };
  }

  return {
    data: { name, description, sortOrder: sortOrder as number },
    errors,
  };
}
