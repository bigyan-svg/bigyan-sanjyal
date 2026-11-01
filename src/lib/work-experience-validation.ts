import type { ContentStatus } from "@/generated/prisma/client";

export const WORK_EXPERIENCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const WORK_EXPERIENCE_EMPLOYER_MAX_LENGTH = 200;
export const WORK_EXPERIENCE_ROLE_TITLE_MAX_LENGTH = 160;
export const WORK_EXPERIENCE_LOCATION_MAX_LENGTH = 160;
export const WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH = 10_000;
export const WORK_EXPERIENCE_SORT_ORDER_MAX = 999_999;

export type WorkExperienceField =
  | "employer"
  | "roleTitle"
  | "location"
  | "description"
  | "startDate"
  | "endDate"
  | "isCurrent"
  | "status"
  | "sortOrder";

export type WorkExperienceFieldErrors = Partial<Record<WorkExperienceField, string>>;

export interface WorkExperienceWriteData {
  employer: string;
  roleTitle: string;
  location: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isCurrent: boolean;
  status: ContentStatus;
  sortOrder: number;
}

export type WorkExperiencePatchData = Partial<WorkExperienceWriteData>;

export interface WorkExperienceRecord extends WorkExperienceWriteData {
  id: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkExperienceMutationData extends WorkExperienceWriteData {
  publishedAt: Date | null;
}

export interface ParsedWorkExperienceInput<T> {
  data: T | null;
  errors: WorkExperienceFieldErrors;
  invalidShape?: boolean;
}

const ALLOWED_FIELDS = new Set<WorkExperienceField>([
  "employer",
  "roleTitle",
  "location",
  "description",
  "startDate",
  "endDate",
  "isCurrent",
  "status",
  "sortOrder",
]);
const WORK_EXPERIENCE_STATUSES = new Set<ContentStatus>([
  "DRAFT",
  "PUBLISHED",
  "ARCHIVED",
]);
const ISO_DATE_PATTERN = /^(?!0000)\d{4}-\d{2}-\d{2}$/u;

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

function parseRequiredText(
  value: unknown,
  field: "employer" | "roleTitle",
  maxLength: number,
  errors: WorkExperienceFieldErrors,
): string | undefined {
  const text = typeof value === "string" ? sanitizeSingleLine(value) : "";
  if (!text) {
    errors[field] = field === "employer" ? "Employer is required." : "Role title is required.";
    return undefined;
  }
  if (lengthInCharacters(text) > maxLength) {
    errors[field] = `Use ${maxLength} characters or fewer.`;
    return undefined;
  }
  return text;
}

function parseOptionalText(
  value: unknown,
  field: "location" | "description",
  maxLength: number,
  multiline: boolean,
  errors: WorkExperienceFieldErrors,
): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    errors[field] = "Enter text for this field.";
    return undefined;
  }

  const text = multiline ? sanitizeMultiline(value) : sanitizeSingleLine(value);
  if (lengthInCharacters(text) > maxLength) {
    errors[field] = `Use ${maxLength.toLocaleString()} characters or fewer.`;
    return undefined;
  }
  return text || null;
}

function parseDate(
  value: unknown,
  field: "startDate" | "endDate",
  errors: WorkExperienceFieldErrors,
): Date | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    errors[field] = "Enter a valid date in YYYY-MM-DD format.";
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    errors[field] = "Enter a real calendar date.";
    return undefined;
  }
  return date;
}

function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === "string" && WORK_EXPERIENCE_STATUSES.has(value as ContentStatus);
}

function validateWorkExperienceState(data: WorkExperienceWriteData): WorkExperienceFieldErrors {
  const errors: WorkExperienceFieldErrors = {};

  if (!data.employer.trim()) errors.employer = "Employer is required.";
  else if (lengthInCharacters(data.employer) > WORK_EXPERIENCE_EMPLOYER_MAX_LENGTH) {
    errors.employer = `Use ${WORK_EXPERIENCE_EMPLOYER_MAX_LENGTH} characters or fewer.`;
  }
  if (!data.roleTitle.trim()) errors.roleTitle = "Role title is required.";
  else if (lengthInCharacters(data.roleTitle) > WORK_EXPERIENCE_ROLE_TITLE_MAX_LENGTH) {
    errors.roleTitle = `Use ${WORK_EXPERIENCE_ROLE_TITLE_MAX_LENGTH} characters or fewer.`;
  }
  if (data.location && lengthInCharacters(data.location) > WORK_EXPERIENCE_LOCATION_MAX_LENGTH) {
    errors.location = `Use ${WORK_EXPERIENCE_LOCATION_MAX_LENGTH} characters or fewer.`;
  }
  if (
    data.description &&
    lengthInCharacters(data.description) > WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH
  ) {
    errors.description = `Use ${WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`;
  }
  if (
    !Number.isInteger(data.sortOrder) ||
    data.sortOrder < 0 ||
    data.sortOrder > WORK_EXPERIENCE_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${WORK_EXPERIENCE_SORT_ORDER_MAX.toLocaleString()}.`;
  }
  if (
    data.startDate &&
    data.endDate &&
    data.endDate.getTime() < data.startDate.getTime()
  ) {
    errors.endDate = "End date must be on or after the start date.";
  }
  if (data.isCurrent && data.endDate !== null) {
    errors.endDate = "A current role cannot have an end date.";
  } else if (!data.isCurrent && data.endDate === null) {
    errors.endDate = "Enter an end date or mark this role as current.";
  }
  if (data.status === "PUBLISHED" && data.startDate === null) {
    errors.startDate = "A start date is required before publishing.";
  }

  return errors;
}

export function parseCreateWorkExperience(
  body: unknown,
): ParsedWorkExperienceInput<WorkExperienceWriteData> {
  if (!isRecord(body) || Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key as WorkExperienceField))) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: WorkExperienceFieldErrors = {};
  const employer = parseRequiredText(
    body.employer,
    "employer",
    WORK_EXPERIENCE_EMPLOYER_MAX_LENGTH,
    errors,
  );
  const roleTitle = parseRequiredText(
    body.roleTitle,
    "roleTitle",
    WORK_EXPERIENCE_ROLE_TITLE_MAX_LENGTH,
    errors,
  );

  const location = parseOptionalText(
    hasOwn(body, "location") ? body.location : null,
    "location",
    WORK_EXPERIENCE_LOCATION_MAX_LENGTH,
    false,
    errors,
  );
  const description = parseOptionalText(
    hasOwn(body, "description") ? body.description : null,
    "description",
    WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH,
    true,
    errors,
  );
  const startDate = parseDate(hasOwn(body, "startDate") ? body.startDate : null, "startDate", errors);
  const endDate = parseDate(hasOwn(body, "endDate") ? body.endDate : null, "endDate", errors);

  const isCurrent = hasOwn(body, "isCurrent") ? body.isCurrent : false;
  if (typeof isCurrent !== "boolean") errors.isCurrent = "Choose whether this is a current role.";

  const status = hasOwn(body, "status") ? body.status : "DRAFT";
  if (!isContentStatus(status)) errors.status = "Choose Draft, Published, or Archived.";

  const sortOrder = hasOwn(body, "sortOrder") ? body.sortOrder : 0;
  if (
    typeof sortOrder !== "number" ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > WORK_EXPERIENCE_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${WORK_EXPERIENCE_SORT_ORDER_MAX.toLocaleString()}.`;
  }

  if (
    Object.keys(errors).length === 0 &&
    employer !== undefined &&
    roleTitle !== undefined &&
    location !== undefined &&
    description !== undefined &&
    startDate !== undefined &&
    endDate !== undefined &&
    typeof isCurrent === "boolean" &&
    isContentStatus(status) &&
    typeof sortOrder === "number"
  ) {
    const data: WorkExperienceWriteData = {
      employer,
      roleTitle,
      location,
      description,
      startDate,
      endDate,
      isCurrent,
      status,
      sortOrder,
    };
    Object.assign(errors, validateWorkExperienceState(data));
    if (Object.keys(errors).length === 0) return { data, errors };
  }

  return { data: null, errors };
}

export function parseUpdateWorkExperience(
  body: unknown,
): ParsedWorkExperienceInput<WorkExperiencePatchData> {
  if (
    !isRecord(body) ||
    Object.keys(body).length === 0 ||
    Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key as WorkExperienceField))
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: WorkExperienceFieldErrors = {};
  const data: WorkExperiencePatchData = {};

  for (const [field, maxLength] of [
    ["employer", WORK_EXPERIENCE_EMPLOYER_MAX_LENGTH],
    ["roleTitle", WORK_EXPERIENCE_ROLE_TITLE_MAX_LENGTH],
  ] as const) {
    if (hasOwn(body, field)) {
      const parsed = parseRequiredText(body[field], field, maxLength, errors);
      if (parsed !== undefined) data[field] = parsed;
    }
  }

  for (const [field, maxLength, multiline] of [
    ["location", WORK_EXPERIENCE_LOCATION_MAX_LENGTH, false],
    ["description", WORK_EXPERIENCE_DESCRIPTION_MAX_LENGTH, true],
  ] as const) {
    if (hasOwn(body, field)) {
      const parsed = parseOptionalText(body[field], field, maxLength, multiline, errors);
      if (parsed !== undefined) data[field] = parsed;
    }
  }

  for (const field of ["startDate", "endDate"] as const) {
    if (hasOwn(body, field)) {
      const parsed = parseDate(body[field], field, errors);
      if (parsed !== undefined) data[field] = parsed;
    }
  }

  if (hasOwn(body, "isCurrent")) {
    if (typeof body.isCurrent !== "boolean") {
      errors.isCurrent = "Choose whether this is a current role.";
    } else {
      data.isCurrent = body.isCurrent;
    }
  }

  if (hasOwn(body, "status")) {
    if (!isContentStatus(body.status)) {
      errors.status = "Choose Draft, Published, or Archived.";
    } else {
      data.status = body.status;
    }
  }

  if (hasOwn(body, "sortOrder")) {
    const sortOrder = body.sortOrder;
    if (
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > WORK_EXPERIENCE_SORT_ORDER_MAX
    ) {
      errors.sortOrder = `Enter a whole number from 0 to ${WORK_EXPERIENCE_SORT_ORDER_MAX.toLocaleString()}.`;
    } else {
      data.sortOrder = sortOrder;
    }
  }

  return Object.keys(errors).length > 0
    ? { data: null, errors }
    : { data, errors };
}

export function resolveWorkExperiencePublishedAt(
  currentPublishedAt: Date | null,
  nextStatus: ContentStatus,
  now = new Date(),
): Date | null {
  if (currentPublishedAt !== null) return currentPublishedAt;
  return nextStatus === "PUBLISHED" ? now : null;
}

export function prepareWorkExperienceUpdate(
  current: WorkExperienceRecord,
  patch: WorkExperiencePatchData,
  now: Date,
): { data: WorkExperienceMutationData | null; errors: WorkExperienceFieldErrors } {
  const merged: WorkExperienceWriteData = {
    employer: patch.employer !== undefined ? patch.employer : current.employer,
    roleTitle: patch.roleTitle !== undefined ? patch.roleTitle : current.roleTitle,
    location: patch.location !== undefined ? patch.location : current.location,
    description: patch.description !== undefined ? patch.description : current.description,
    startDate: patch.startDate !== undefined ? patch.startDate : current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
    isCurrent: patch.isCurrent !== undefined ? patch.isCurrent : current.isCurrent,
    status: patch.status !== undefined ? patch.status : current.status,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder,
  };
  const errors = validateWorkExperienceState(merged);
  if (Object.keys(errors).length > 0) return { data: null, errors };

  return {
    data: {
      ...merged,
      publishedAt: resolveWorkExperiencePublishedAt(current.publishedAt, merged.status, now),
    },
    errors,
  };
}
