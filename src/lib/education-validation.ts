import type { ContentStatus } from "@/generated/prisma/client";

export const EDUCATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const EDUCATION_INSTITUTION_MAX_LENGTH = 200;
export const EDUCATION_PROGRAM_MAX_LENGTH = 200;
export const EDUCATION_FIELD_OF_STUDY_MAX_LENGTH = 200;
export const EDUCATION_DESCRIPTION_MAX_LENGTH = 10_000;
export const EDUCATION_SORT_ORDER_MAX = 999_999;

export type EducationField =
  | "institution"
  | "program"
  | "fieldOfStudy"
  | "description"
  | "startDate"
  | "endDate"
  | "isCurrent"
  | "status"
  | "sortOrder";

export type EducationFieldErrors = Partial<Record<EducationField, string>>;

export interface EducationWriteData {
  institution: string;
  program: string;
  fieldOfStudy: string | null;
  description: string | null;
  startDate: Date | null;
  endDate: Date | null;
  isCurrent: boolean;
  status: ContentStatus;
  sortOrder: number;
}

export type EducationPatchData = Partial<EducationWriteData>;

export interface EducationRecord extends EducationWriteData {
  id: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EducationMutationData extends EducationWriteData {
  publishedAt: Date | null;
}

export interface ParsedEducationInput<T> {
  data: T | null;
  errors: EducationFieldErrors;
  invalidShape?: boolean;
}

const ALLOWED_FIELDS = new Set<EducationField>([
  "institution",
  "program",
  "fieldOfStudy",
  "description",
  "startDate",
  "endDate",
  "isCurrent",
  "status",
  "sortOrder",
]);
const EDUCATION_STATUSES = new Set<ContentStatus>([
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
  field: "institution" | "program",
  maxLength: number,
  errors: EducationFieldErrors,
): string | undefined {
  const text = typeof value === "string" ? sanitizeSingleLine(value) : "";
  if (!text) {
    errors[field] = field === "institution"
      ? "Institution is required."
      : "Program is required.";
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
  field: "fieldOfStudy" | "description",
  maxLength: number,
  multiline: boolean,
  errors: EducationFieldErrors,
): string | null | undefined {
  if (value === null) return null;
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
  errors: EducationFieldErrors,
): Date | null | undefined {
  if (value === null) return null;
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
  return typeof value === "string" && EDUCATION_STATUSES.has(value as ContentStatus);
}

export function validateEducationState(data: EducationWriteData): EducationFieldErrors {
  const errors: EducationFieldErrors = {};

  if (!data.institution.trim()) errors.institution = "Institution is required.";
  else if (lengthInCharacters(data.institution) > EDUCATION_INSTITUTION_MAX_LENGTH) {
    errors.institution = `Use ${EDUCATION_INSTITUTION_MAX_LENGTH} characters or fewer.`;
  }
  if (!data.program.trim()) errors.program = "Program is required.";
  else if (lengthInCharacters(data.program) > EDUCATION_PROGRAM_MAX_LENGTH) {
    errors.program = `Use ${EDUCATION_PROGRAM_MAX_LENGTH} characters or fewer.`;
  }
  if (
    data.fieldOfStudy &&
    lengthInCharacters(data.fieldOfStudy) > EDUCATION_FIELD_OF_STUDY_MAX_LENGTH
  ) {
    errors.fieldOfStudy = `Use ${EDUCATION_FIELD_OF_STUDY_MAX_LENGTH} characters or fewer.`;
  }
  if (
    data.description &&
    lengthInCharacters(data.description) > EDUCATION_DESCRIPTION_MAX_LENGTH
  ) {
    errors.description = `Use ${EDUCATION_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.`;
  }
  if (
    !Number.isInteger(data.sortOrder) ||
    data.sortOrder < 0 ||
    data.sortOrder > EDUCATION_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${EDUCATION_SORT_ORDER_MAX.toLocaleString()}.`;
  }
  if (data.startDate && data.endDate && data.endDate.getTime() < data.startDate.getTime()) {
    errors.endDate = "End date must be on or after the start date.";
  }
  if (data.isCurrent && data.endDate !== null) {
    errors.endDate = "A current study record cannot have an end date.";
  }

  return errors;
}

export function parseCreateEducation(
  body: unknown,
): ParsedEducationInput<EducationWriteData> {
  if (!isRecord(body) || Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key as EducationField))) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: EducationFieldErrors = {};
  const institution = parseRequiredText(
    body.institution,
    "institution",
    EDUCATION_INSTITUTION_MAX_LENGTH,
    errors,
  );
  const program = parseRequiredText(
    body.program,
    "program",
    EDUCATION_PROGRAM_MAX_LENGTH,
    errors,
  );
  const fieldOfStudy = parseOptionalText(
    hasOwn(body, "fieldOfStudy") ? body.fieldOfStudy : null,
    "fieldOfStudy",
    EDUCATION_FIELD_OF_STUDY_MAX_LENGTH,
    false,
    errors,
  );
  const description = parseOptionalText(
    hasOwn(body, "description") ? body.description : null,
    "description",
    EDUCATION_DESCRIPTION_MAX_LENGTH,
    true,
    errors,
  );
  const startDate = parseDate(hasOwn(body, "startDate") ? body.startDate : null, "startDate", errors);
  const endDate = parseDate(hasOwn(body, "endDate") ? body.endDate : null, "endDate", errors);

  const isCurrent = hasOwn(body, "isCurrent") ? body.isCurrent : false;
  if (typeof isCurrent !== "boolean") errors.isCurrent = "Choose whether this is current study.";

  const status = hasOwn(body, "status") ? body.status : "DRAFT";
  if (!isContentStatus(status)) errors.status = "Choose Draft, Published, or Archived.";

  const sortOrder = hasOwn(body, "sortOrder") ? body.sortOrder : 0;
  if (
    typeof sortOrder !== "number" ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > EDUCATION_SORT_ORDER_MAX
  ) {
    errors.sortOrder = `Enter a whole number from 0 to ${EDUCATION_SORT_ORDER_MAX.toLocaleString()}.`;
  }

  if (
    Object.keys(errors).length === 0 &&
    institution !== undefined &&
    program !== undefined &&
    fieldOfStudy !== undefined &&
    description !== undefined &&
    startDate !== undefined &&
    endDate !== undefined &&
    typeof isCurrent === "boolean" &&
    isContentStatus(status) &&
    typeof sortOrder === "number"
  ) {
    const data: EducationWriteData = {
      institution,
      program,
      fieldOfStudy,
      description,
      startDate,
      endDate,
      isCurrent,
      status,
      sortOrder,
    };
    Object.assign(errors, validateEducationState(data));
    if (Object.keys(errors).length === 0) return { data, errors };
  }

  return { data: null, errors };
}

export function parseUpdateEducation(
  body: unknown,
): ParsedEducationInput<EducationPatchData> {
  if (
    !isRecord(body) ||
    Object.keys(body).length === 0 ||
    Object.keys(body).some((key) => !ALLOWED_FIELDS.has(key as EducationField))
  ) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const errors: EducationFieldErrors = {};
  const data: EducationPatchData = {};

  for (const [field, maxLength] of [
    ["institution", EDUCATION_INSTITUTION_MAX_LENGTH],
    ["program", EDUCATION_PROGRAM_MAX_LENGTH],
  ] as const) {
    if (hasOwn(body, field)) {
      const parsed = parseRequiredText(body[field], field, maxLength, errors);
      if (parsed !== undefined) data[field] = parsed;
    }
  }

  for (const [field, maxLength, multiline] of [
    ["fieldOfStudy", EDUCATION_FIELD_OF_STUDY_MAX_LENGTH, false],
    ["description", EDUCATION_DESCRIPTION_MAX_LENGTH, true],
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
      errors.isCurrent = "Choose whether this is current study.";
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
      sortOrder > EDUCATION_SORT_ORDER_MAX
    ) {
      errors.sortOrder = `Enter a whole number from 0 to ${EDUCATION_SORT_ORDER_MAX.toLocaleString()}.`;
    } else {
      data.sortOrder = sortOrder;
    }
  }

  return Object.keys(errors).length > 0
    ? { data: null, errors }
    : { data, errors };
}

export function resolveEducationPublishedAt(
  currentPublishedAt: Date | null,
  nextStatus: ContentStatus,
  now = new Date(),
): Date | null {
  if (currentPublishedAt !== null) return currentPublishedAt;
  return nextStatus === "PUBLISHED" ? now : null;
}

export function prepareEducationUpdate(
  current: EducationRecord,
  patch: EducationPatchData,
  now: Date,
): { data: EducationMutationData | null; errors: EducationFieldErrors } {
  const merged: EducationWriteData = {
    institution: patch.institution !== undefined ? patch.institution : current.institution,
    program: patch.program !== undefined ? patch.program : current.program,
    fieldOfStudy: patch.fieldOfStudy !== undefined ? patch.fieldOfStudy : current.fieldOfStudy,
    description: patch.description !== undefined ? patch.description : current.description,
    startDate: patch.startDate !== undefined ? patch.startDate : current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
    isCurrent: patch.isCurrent !== undefined ? patch.isCurrent : current.isCurrent,
    status: patch.status !== undefined ? patch.status : current.status,
    sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder,
  };
  const errors = validateEducationState(merged);
  if (Object.keys(errors).length > 0) return { data: null, errors };

  return {
    data: {
      ...merged,
      publishedAt: resolveEducationPublishedAt(current.publishedAt, merged.status, now),
    },
    errors,
  };
}
