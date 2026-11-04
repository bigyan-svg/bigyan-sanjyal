import "server-only";

import { adminContentResponse } from "@/lib/auth/admin-content-session";
import {
  ProjectSkillMissingError,
  type ProjectDeleteOutcome,
  type ProjectUpdateResult,
} from "@/lib/project-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { expectedVersionEntityTag, parseExpectedVersion } from "@/lib/optimistic-version";
import { PROJECT_ID_PATTERN, parseProjectInput } from "@/lib/project-validation";

function prismaErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

export async function handleProjectUpdate(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    update(
      id: string,
      input: NonNullable<ReturnType<typeof parseProjectInput>["data"]>,
      expectedVersion: number,
      now: Date,
    ): Promise<ProjectUpdateResult>;
    now?: () => Date;
  },
): Promise<Response> {
  const authorizationError = await dependencies.authorize(request);
  if (authorizationError) return authorizationError;

  if (!PROJECT_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Project not found." }, 404);
  }

  const expectedVersion = parseExpectedVersion(request.headers.get("If-Match"));
  if (expectedVersion === null) {
    return adminContentResponse(
      { error: "A valid expected version is required. Reload the project and try again." },
      400,
    );
  }

  let body: unknown;
  try {
    body = await readJsonRequest(request);
  } catch (error) {
    return error instanceof JsonRequestTooLargeError
      ? adminContentResponse({ error: "Request body is too large." }, 413)
      : adminContentResponse({ error: "Invalid request." }, 400);
  }

  const parsed = parseProjectInput(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid project data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const result = await dependencies.update(
      id,
      parsed.data,
      expectedVersion,
      dependencies.now?.() ?? new Date(),
    );
    if (result.kind === "missing") {
      return adminContentResponse({ error: "Project not found." }, 404);
    }
    if (result.kind === "conflict") {
      return adminContentResponse(
        { error: "This project changed since you opened it. Reload the latest version and reconcile your edits before saving again." },
        409,
      );
    }
    if (result.kind === "category-missing") {
      return adminContentResponse(
        {
          error: "Please correct the highlighted fields.",
          fields: { categoryId: "Choose an existing category." },
        },
        422,
      );
    }
    if (result.kind === "unsafe-public-media") {
      return adminContentResponse(
        {
          error: "Published projects can only use HTTPS links and images.",
          fields: {
            links: "Use HTTPS links before publishing.",
            images: "Use HTTPS images before publishing.",
          },
        },
        422,
      );
    }

    return adminContentResponse(
      { project: result.project },
      200,
      { ETag: expectedVersionEntityTag(result.project.version) },
    );
  } catch (error) {
    const code = prismaErrorCode(error);
    if (error instanceof ProjectSkillMissingError) {
      return adminContentResponse(
        { error: "Please correct the highlighted fields.", fields: { skillIds: "Choose existing skills." } },
        422,
      );
    }
    if (code === "P2002") {
      return adminContentResponse({ error: "A project with this slug already exists." }, 409);
    }
    if (code === "P2025") {
      return adminContentResponse({ error: "Project not found." }, 404);
    }
    if (code === "P2003") {
      return adminContentResponse(
        {
          error: "The project category or one of the selected skills no longer exists.",
          fields: {
            categoryId: "Choose an existing category.",
            skillIds: "Choose existing skills.",
          },
        },
        422,
      );
    }
    return adminContentResponse({ error: "Unable to update the project." }, 500);
  }
}

export async function handleProjectDelete(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    delete(id: string, expectedVersion: number): Promise<ProjectDeleteOutcome>;
  },
): Promise<Response> {
  const authorizationError = await dependencies.authorize(request);
  if (authorizationError) return authorizationError;

  if (!PROJECT_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Project not found." }, 404);
  }

  const expectedVersion = parseExpectedVersion(request.headers.get("If-Match"));
  if (expectedVersion === null) {
    return adminContentResponse(
      { error: "A valid expected version is required. Reload the project and try again." },
      400,
    );
  }

  try {
    const result = await dependencies.delete(id, expectedVersion);
    if (result.kind === "missing") {
      return adminContentResponse({ error: "Project not found." }, 404);
    }
    if (result.kind === "conflict") {
      return adminContentResponse(
        { error: "This project changed since it was listed. Reload the latest Project data before deleting it." },
        409,
      );
    }
    return adminContentResponse({ success: true }, 200);
  } catch {
    return adminContentResponse({ error: "Unable to delete the project." }, 500);
  }
}
