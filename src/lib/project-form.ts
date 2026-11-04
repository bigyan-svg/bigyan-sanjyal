import type { AdminProjectItem } from "./project-types";
import type { ProjectFieldErrors, ProjectInputData } from "./project-validation";
import { expectedVersionEntityTag, MAX_DATABASE_INT } from "./optimistic-version";

export type ProjectSaveResult =
  | { ok: true; project: AdminProjectItem }
  | { ok: false; error: string; fields: ProjectFieldErrors };

export type ProjectDeleteResult =
  | { ok: true }
  | { ok: false; error: string; outcome: "definite" | "unknown" };

function readError(value: unknown, fallback: string): string {
  if (typeof value === "object" && value !== null && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  return fallback;
}

function readFields(value: unknown): ProjectFieldErrors {
  if (
    typeof value === "object" && value !== null &&
    "fields" in value && typeof value.fields === "object" && value.fields !== null
  ) {
    return value.fields as ProjectFieldErrors;
  }
  return {};
}

function isProjectResponse(value: unknown): value is { project: AdminProjectItem } {
  if (typeof value !== "object" || value === null || !("project" in value)) return false;
  const project = value.project;
  return (
    typeof project === "object" && project !== null &&
    "id" in project && typeof project.id === "string" &&
    "version" in project && typeof project.version === "number" &&
    Number.isSafeInteger(project.version) && project.version > 0
  );
}

function isDeleteSuccessResponse(value: unknown): value is { success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true
  );
}

function unconfirmedDeleteResult(): ProjectDeleteResult {
  return {
    ok: false,
    outcome: "unknown",
    error: "Unable to confirm whether the project was deleted. Reload the latest Project data before trying again.",
  };
}

function deleteFailureResult(status: number, result: unknown): ProjectDeleteResult {
  if (status === 409) {
    return {
      ok: false,
      outcome: "definite",
      error: "This project changed since it was listed. Reload the latest Project data before deleting it.",
    };
  }
  if (status === 404) {
    return { ok: false, outcome: "definite", error: "Project not found." };
  }
  return {
    ok: false,
    outcome: "definite",
    error: readError(result, `Unable to delete project (HTTP ${status}).`),
  };
}

export async function saveProjectRecord(
  project: Pick<AdminProjectItem, "id" | "version"> | null,
  payload: ProjectInputData,
  fetcher: typeof fetch = fetch,
): Promise<ProjectSaveResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (project) headers.set("If-Match", expectedVersionEntityTag(project.version));

  try {
    const response = await fetcher(
      project ? `/api/admin/projects/${project.id}` : "/api/admin/projects",
      {
        method: project ? "PATCH" : "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers,
        body: JSON.stringify(payload),
      },
    );
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const fallback = response.status === 409
        ? "This project changed since it was opened. Reload the latest version and reconcile your edits before saving again."
        : `Unable to save the project (HTTP ${response.status}).`;
      return { ok: false, error: readError(result, fallback), fields: readFields(result) };
    }
    if (!isProjectResponse(result)) {
      return {
        ok: false,
        error: "The project was saved, but its versioned details could not be loaded. Please reload the page.",
        fields: {},
      };
    }
    return { ok: true, project: result.project };
  } catch {
    return {
      ok: false,
      error: "Unable to save the project. Please try again.",
      fields: {},
    };
  }
}

export async function deleteProjectRecord(
  projectId: string,
  expectedVersion: number,
  fetcher: typeof fetch = fetch,
): Promise<ProjectDeleteResult> {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    expectedVersion > MAX_DATABASE_INT
  ) {
    return {
      ok: false,
      outcome: "definite",
      error: "The project version is invalid. Reload the latest Project data before deleting it.",
    };
  }

  try {
    const response = await fetcher(`/api/admin/projects/${projectId}`, {
      method: "DELETE",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "If-Match": expectedVersionEntityTag(expectedVersion) },
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status >= 500) return unconfirmedDeleteResult();
      return deleteFailureResult(response.status, result);
    }
    return isDeleteSuccessResponse(result) ? { ok: true } : unconfirmedDeleteResult();
  } catch {
    return unconfirmedDeleteResult();
  }
}
