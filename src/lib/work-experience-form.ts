import type { ContentStatus } from "@/generated/prisma/client";
import {
  parseCreateWorkExperience,
  type WorkExperienceField,
} from "./work-experience-validation";

export interface WorkExperienceFormValues {
  employer: string;
  roleTitle: string;
  location: string;
  description: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  sortOrder: string;
  status: ContentStatus;
}

export interface AdminWorkExperienceItem {
  id: string;
  employer: string;
  roleTitle: string;
  location: string | null;
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

export type WorkExperienceFormFieldErrors = Partial<Record<WorkExperienceField, string>>;

export interface WorkExperienceRequestBody {
  employer: string;
  roleTitle: string;
  location: string | null;
  description: string | null;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
  sortOrder: number;
  status: ContentStatus;
}

export type WorkExperienceRequestResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string; fields?: WorkExperienceFormFieldErrors; unauthorized?: boolean; cancelled?: boolean };

const FIELD_NAMES = new Set<WorkExperienceField>([
  "employer", "roleTitle", "location", "description", "startDate", "endDate",
  "isCurrent", "status", "sortOrder",
]);

export function createEmptyWorkExperienceFormValues(sortOrder = 0): WorkExperienceFormValues {
  return {
    employer: "",
    roleTitle: "",
    location: "",
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

export function workExperienceToFormValues(
  item: AdminWorkExperienceItem,
): WorkExperienceFormValues {
  return {
    employer: item.employer,
    roleTitle: item.roleTitle,
    location: item.location ?? "",
    description: item.description ?? "",
    startDate: dateInputValue(item.startDate),
    endDate: dateInputValue(item.endDate),
    isCurrent: item.isCurrent,
    sortOrder: String(item.sortOrder),
    status: item.status,
  };
}

export function setCurrentEmployment(
  values: WorkExperienceFormValues,
  isCurrent: boolean,
): WorkExperienceFormValues {
  return { ...values, isCurrent, endDate: isCurrent ? "" : values.endDate };
}

export function workExperienceFormPayload(
  values: WorkExperienceFormValues,
): WorkExperienceRequestBody {
  return {
    employer: values.employer,
    roleTitle: values.roleTitle,
    location: values.location,
    description: values.description,
    startDate: values.startDate,
    endDate: values.isCurrent ? null : values.endDate,
    isCurrent: values.isCurrent,
    sortOrder: values.sortOrder.trim() === "" ? Number.NaN : Number(values.sortOrder),
    status: values.status,
  };
}

export function validateWorkExperienceForm(
  values: WorkExperienceFormValues,
): WorkExperienceFormFieldErrors {
  const payload = workExperienceFormPayload(values);
  const parsed = parseCreateWorkExperience(payload);
  const errors: WorkExperienceFormFieldErrors = { ...parsed.errors };

  if (!values.startDate.trim()) {
    errors.startDate = "Start date is required.";
  }

  return errors;
}

function responseError(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = value.error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function responseFields(value: unknown): WorkExperienceFormFieldErrors {
  if (typeof value !== "object" || value === null || !("fields" in value)) return {};
  const fields = value.fields;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) return {};

  return Object.fromEntries(
    Object.entries(fields).filter(([key, message]) =>
      FIELD_NAMES.has(key as WorkExperienceField) && typeof message === "string",
    ),
  ) as WorkExperienceFormFieldErrors;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function failureFromResponse(
  response: Response,
  body: unknown,
  fallback: string,
): WorkExperienceRequestResult<never> {
  if (response.status === 401) {
    return { ok: false, unauthorized: true, error: "Your admin session has expired. Please sign in again." };
  }
  return {
    ok: false,
    error: responseError(body, `${fallback} (HTTP ${response.status}).`),
    fields: responseFields(body),
  };
}

export async function loadWorkExperienceRecords(
  fetcher: typeof fetch = fetch,
): Promise<WorkExperienceRequestResult<AdminWorkExperienceItem[]>> {
  try {
    const response = await fetcher("/api/admin/experience", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to load work experience");
    if (
      typeof body !== "object" || body === null || !("experiences" in body) ||
      !Array.isArray(body.experiences)
    ) {
      return { ok: false, error: "Unable to load work experience. Please try again." };
    }
    return { ok: true, value: body.experiences as AdminWorkExperienceItem[] };
  } catch {
    return { ok: false, error: "Unable to load work experience. Check your connection and try again." };
  }
}

export async function saveWorkExperienceRecord(
  id: string | null,
  values: WorkExperienceFormValues,
  fetcher: typeof fetch = fetch,
): Promise<WorkExperienceRequestResult> {
  const fields = validateWorkExperienceForm(values);
  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Please correct the highlighted fields.", fields };
  }

  try {
    const response = await fetcher(id ? `/api/admin/experience/${id}` : "/api/admin/experience", {
      method: id ? "PATCH" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workExperienceFormPayload(values)),
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to save work experience");
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: "Unable to save work experience. Check your connection and try again." };
  }
}

export async function deleteWorkExperienceRecord(
  id: string,
  confirmed: boolean,
  fetcher: typeof fetch = fetch,
): Promise<WorkExperienceRequestResult> {
  if (!confirmed) return { ok: false, cancelled: true, error: "Deletion was not confirmed." };

  try {
    const response = await fetcher(`/api/admin/experience/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to delete work experience");
    return { ok: true, value: undefined };
  } catch {
    return { ok: false, error: "Unable to delete work experience. Check your connection and try again." };
  }
}
