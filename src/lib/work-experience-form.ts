import type { ContentStatus, EmploymentType } from "@/generated/prisma/client";
import {
  parseCreateWorkExperience,
  type WorkExperienceField,
} from "./work-experience-validation";
import { expectedVersionEntityTag, MAX_DATABASE_INT } from "./optimistic-version";

export interface WorkExperienceFormValues {
  employer: string;
  roleTitle: string;
  employmentType: EmploymentType | "";
  location: string;
  description: string;
  startDate: string;
  endDate: string;
  currentPosition: boolean;
  sortOrder: string;
  status: ContentStatus;
}

export interface AdminWorkExperienceItem {
  id: string;
  version: number;
  employer: string;
  roleTitle: string;
  employmentType: EmploymentType;
  location: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  currentPosition: boolean;
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
  employmentType: EmploymentType | "";
  location: string | null;
  description: string | null;
  startDate: string;
  endDate: string | null;
  currentPosition: boolean;
  sortOrder: number;
  status: ContentStatus;
}

export type WorkExperienceRequestResult<T = undefined> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: string;
      fields?: WorkExperienceFormFieldErrors;
      unauthorized?: boolean;
      cancelled?: boolean;
      outcome?: "definite" | "unknown";
    };

export function workExperienceSaveSuccessMessage(
  result: WorkExperienceRequestResult<AdminWorkExperienceItem>,
  operation: "create" | "update",
): string {
  if (!result.ok) return "";
  return operation === "create"
    ? "Work experience created successfully."
    : "Work experience updated successfully.";
}

type SuccessfulWorkExperienceSave = Extract<
  WorkExperienceRequestResult<AdminWorkExperienceItem>,
  { ok: true }
>;
type FailedWorkExperienceSave = Extract<
  WorkExperienceRequestResult<AdminWorkExperienceItem>,
  { ok: false }
>;

export function workExperienceSaveEditorTransition<TEditor>(
  currentEditor: TEditor,
  result: SuccessfulWorkExperienceSave,
  operation: "create" | "update",
): { editor: null; successMessage: string };
export function workExperienceSaveEditorTransition<TEditor>(
  currentEditor: TEditor,
  result: FailedWorkExperienceSave,
  operation: "create" | "update",
): { editor: TEditor; successMessage: "" };
export function workExperienceSaveEditorTransition<TEditor>(
  currentEditor: TEditor,
  result: WorkExperienceRequestResult<AdminWorkExperienceItem>,
  operation: "create" | "update",
): { editor: TEditor | null; successMessage: string } {
  if (!result.ok) return { editor: currentEditor, successMessage: "" };
  return {
    editor: null,
    successMessage: workExperienceSaveSuccessMessage(result, operation),
  };
}

const FIELD_NAMES = new Set<WorkExperienceField>([
  "employer", "roleTitle", "location", "description", "startDate", "endDate",
  "employmentType", "currentPosition", "status", "sortOrder",
]);

export function createEmptyWorkExperienceFormValues(sortOrder = 0): WorkExperienceFormValues {
  return {
    employer: "",
    roleTitle: "",
    employmentType: "",
    location: "",
    description: "",
    startDate: "",
    endDate: "",
    currentPosition: false,
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
    employmentType: item.employmentType,
    location: item.location ?? "",
    description: item.description ?? "",
    startDate: dateInputValue(item.startDate),
    endDate: item.currentPosition ? "" : dateInputValue(item.endDate),
    currentPosition: item.currentPosition,
    sortOrder: String(item.sortOrder),
    status: item.status,
  };
}

export function setCurrentEmployment(
  values: WorkExperienceFormValues,
  currentPosition: boolean,
): WorkExperienceFormValues {
  return { ...values, currentPosition, endDate: currentPosition ? "" : values.endDate };
}

export function workExperienceFormPayload(
  values: WorkExperienceFormValues,
): WorkExperienceRequestBody {
  return {
    employer: values.employer,
    roleTitle: values.roleTitle,
    employmentType: values.employmentType,
    location: values.location,
    description: values.description,
    startDate: values.startDate,
    endDate: values.currentPosition ? null : values.endDate,
    currentPosition: values.currentPosition,
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

function isDeleteSuccessResponse(value: unknown): value is { success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true
  );
}

function unconfirmedDeleteResult(): WorkExperienceRequestResult<never> {
  return {
    ok: false,
    outcome: "unknown",
    error: "Unable to confirm whether the work experience record was deleted. Reload the list before trying again.",
  };
}

function failureFromResponse(
  response: Response,
  body: unknown,
  fallback: string,
): Extract<WorkExperienceRequestResult<never>, { ok: false }> {
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
  expectedVersion?: number,
): Promise<WorkExperienceRequestResult<AdminWorkExperienceItem>> {
  const fields = validateWorkExperienceForm(values);
  if (Object.keys(fields).length > 0) {
    return { ok: false, error: "Please correct the highlighted fields.", fields };
  }
  if (
    id !== null &&
    (!Number.isSafeInteger(expectedVersion) || expectedVersion === undefined || expectedVersion < 1 || expectedVersion > MAX_DATABASE_INT)
  ) {
    return { ok: false, error: "Reload this record before saving so its current version can be checked." };
  }

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (id !== null) headers.set("If-Match", expectedVersionEntityTag(expectedVersion!));
    const response = await fetcher(id ? `/api/admin/experience/${id}` : "/api/admin/experience", {
      method: id ? "PATCH" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(workExperienceFormPayload(values)),
    });
    const body = await readJson(response);
    if (!response.ok) return failureFromResponse(response, body, "Unable to save work experience");
    const experience = typeof body === "object" && body !== null && "experience" in body
      ? body.experience
      : null;
    if (
      typeof experience !== "object" || experience === null || !("version" in experience) ||
      typeof experience.version !== "number" || !Number.isSafeInteger(experience.version) ||
      experience.version < 1
    ) {
      return { ok: false, error: "The record was saved, but its new version could not be confirmed. Reload before editing again." };
    }
    return { ok: true, value: experience as AdminWorkExperienceItem };
  } catch {
    return { ok: false, error: "Unable to save work experience. Check your connection and try again." };
  }
}

export async function deleteWorkExperienceRecord(
  id: string,
  expectedVersion: number,
  confirmed: boolean,
  fetcher: typeof fetch = fetch,
): Promise<WorkExperienceRequestResult> {
  if (!confirmed) return { ok: false, cancelled: true, error: "Deletion was not confirmed." };
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_DATABASE_INT
  ) {
    return { ok: false, error: "Reload this record before deleting so its current version can be checked." };
  }

  try {
    const headers = new Headers();
    headers.set("If-Match", expectedVersionEntityTag(expectedVersion));
    const response = await fetcher(`/api/admin/experience/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers,
    });
    const body = await readJson(response);
    if (!response.ok) {
      if (response.status === 401) {
        return failureFromResponse(response, body, "Unable to delete work experience");
      }
      if (response.status >= 500) return unconfirmedDeleteResult();
      return {
        ...failureFromResponse(response, body, "Unable to delete work experience"),
        outcome: "definite",
      };
    }
    return isDeleteSuccessResponse(body)
      ? { ok: true, value: undefined }
      : unconfirmedDeleteResult();
  } catch {
    return unconfirmedDeleteResult();
  }
}

export async function runWorkExperienceRequestOnce<T>(
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
