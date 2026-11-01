import type { ContentStatus } from "@/generated/prisma/client";
import {
  parseCreateEducation,
  type EducationField,
} from "./education-validation";

export interface EducationFormValues {
  institution: string;
  program: string;
  fieldOfStudy: string;
  description: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  sortOrder: string;
  status: ContentStatus;
}

export interface AdminEducationItem {
  id: string;
  institution: string;
  program: string;
  fieldOfStudy: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  status: ContentStatus;
  publishedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EducationRequestBody {
  institution: string;
  program: string;
  fieldOfStudy: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  sortOrder: number;
  status: ContentStatus;
}

export type EducationFormFieldErrors = Partial<Record<EducationField, string>>;

export type EducationRequestResult<T = undefined> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      fields?: EducationFormFieldErrors;
      unauthorized?: boolean;
      cancelled?: boolean;
    };

const FIELD_NAMES = new Set<EducationField>([
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

export function createEmptyEducationFormValues(sortOrder = 0): EducationFormValues {
  return {
    institution: "",
    program: "",
    fieldOfStudy: "",
    description: "",
    startDate: "",
    endDate: "",
    isCurrent: false,
    sortOrder: String(sortOrder),
    status: "DRAFT",
  };
}

function dateInputValue(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : "";
}

export function educationToFormValues(item: AdminEducationItem): EducationFormValues {
  return {
    institution: item.institution,
    program: item.program,
    fieldOfStudy: item.fieldOfStudy ?? "",
    description: item.description ?? "",
    startDate: dateInputValue(item.startDate),
    endDate: dateInputValue(item.endDate),
    isCurrent: item.isCurrent,
    sortOrder: String(item.sortOrder),
    status: item.status,
  };
}

export function setCurrentEducation(
  values: EducationFormValues,
  isCurrent: boolean,
): EducationFormValues {
  return { ...values, isCurrent, endDate: isCurrent ? "" : values.endDate };
}

export function educationFormPayload(values: EducationFormValues): EducationRequestBody {
  return {
    institution: values.institution,
    program: values.program,
    fieldOfStudy: values.fieldOfStudy.trim() === "" ? null : values.fieldOfStudy,
    description: values.description.trim() === "" ? null : values.description,
    startDate: values.startDate === "" ? null : values.startDate,
    endDate: values.isCurrent || values.endDate === "" ? null : values.endDate,
    isCurrent: values.isCurrent,
    sortOrder: values.sortOrder.trim() === "" ? Number.NaN : Number(values.sortOrder),
    status: values.status,
  };
}

export function validateEducationForm(
  values: EducationFormValues,
): EducationFormFieldErrors {
  const parsed = parseCreateEducation(educationFormPayload(values));
  return parsed.errors;
}

function responseError(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function responseFields(value: unknown): EducationFormFieldErrors {
  if (typeof value !== "object" || value === null || !("fields" in value)) return {};
  const fields = value.fields;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return {};

  return Object.fromEntries(
    Object.entries(fields).filter(([key, message]) =>
      FIELD_NAMES.has(key as EducationField) && typeof message === "string",
    ),
  ) as EducationFormFieldErrors;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function failureFromResponse(
  response: Response,
  body: unknown,
  fallback: string,
): EducationRequestResult<never> {
  if (response.status === 401) {
    return {
      ok: false,
      unauthorized: true,
      error: "Your admin session has expired. Please sign in again.",
    };
  }
  return {
    ok: false,
    error: responseError(body, `${fallback} (HTTP ${response.status}).`),
    fields: responseFields(body),
  };
}

export async function loadEducationRecords(
  fetcher: typeof fetch = fetch,
): Promise<EducationRequestResult<AdminEducationItem[]>> {
  try {
    const response = await fetcher("/api/admin/education", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to load Education records");
    if (
      typeof body !== "object" || body === null || !("educations" in body) ||
      !Array.isArray(body.educations)
    ) {
      return { ok: false, error: "Unable to load Education records. Please try again." };
    }
    return { ok: true, value: body.educations as AdminEducationItem[] };
  } catch {
    return {
      ok: false,
      error: "Unable to load Education records. Check your connection and try again.",
    };
  }
}

export async function saveEducationRecord(
  id: string | null,
  values: EducationFormValues,
  fetcher: typeof fetch = fetch,
): Promise<EducationRequestResult> {
  const fields = validateEducationForm(values);
  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Please correct the highlighted fields.", fields };
  }

  try {
    const response = await fetcher(id ? `/api/admin/education/${id}` : "/api/admin/education", {
      method: id ? "PATCH" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(educationFormPayload(values)),
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to save the Education record");
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error: "Unable to save the Education record. Check your connection and try again.",
    };
  }
}

export async function deleteEducationRecord(
  id: string,
  confirmed: boolean,
  fetcher: typeof fetch = fetch,
): Promise<EducationRequestResult> {
  if (!confirmed) {
    return { ok: false, cancelled: true, error: "Deletion was not confirmed." };
  }

  try {
    const response = await fetcher(`/api/admin/education/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to delete the Education record");
    return { ok: true, value: undefined };
  } catch {
    return {
      ok: false,
      error: "Unable to delete the Education record. Check your connection and try again.",
    };
  }
}

export async function runEducationRequestOnce<T>(
  lock: { current: boolean },
  request: () => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> {
  if (lock.current) return { started: false };
  lock.current = true;
  try {
    return { started: true, value: await request() };
  } finally {
    lock.current = false;
  }
}
