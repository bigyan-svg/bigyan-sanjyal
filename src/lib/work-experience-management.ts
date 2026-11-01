import {
  JsonRequestTooLargeError,
  readJsonRequest,
} from "./json-request";
import {
  parseCreateWorkExperience,
  parseUpdateWorkExperience,
  resolveWorkExperiencePublishedAt,
  WORK_EXPERIENCE_ID_PATTERN,
  type WorkExperienceFieldErrors,
  type WorkExperienceMutationData,
  type WorkExperiencePatchData,
  type WorkExperienceRecord,
} from "./work-experience-validation";

export const WORK_EXPERIENCE_REQUEST_MAX_BYTES = 64 * 1024;

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getAuthorizationError(
  request: Request,
  authorize: (request: Request) => Promise<Response | null>,
): Promise<Response | null> {
  try {
    return await authorize(request);
  } catch {
    return jsonResponse({ error: "Unable to authorize this request." }, 500);
  }
}

async function readRequestBody(request: Request): Promise<
  | { body: unknown; response: null }
  | { body: null; response: Response }
> {
  try {
    return { body: await readJsonRequest(request, WORK_EXPERIENCE_REQUEST_MAX_BYTES), response: null };
  } catch (error) {
    return {
      body: null,
      response: error instanceof JsonRequestTooLargeError
        ? jsonResponse({ error: "Request body is too large." }, 413)
        : jsonResponse({ error: "Invalid request." }, 400),
    };
  }
}

export interface WorkExperienceUpdateResult {
  kind: "missing" | "invalid" | "updated";
  errors?: WorkExperienceFieldErrors;
  experience?: WorkExperienceRecord;
}

export async function handleWorkExperienceList(
  request: Request,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    findAll(): Promise<WorkExperienceRecord[]>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  try {
    const experiences = await dependencies.findAll();
    return jsonResponse({ experiences }, 200);
  } catch {
    return jsonResponse({ error: "Unable to load work experience." }, 500);
  }
}

export async function handleWorkExperienceCreate(
  request: Request,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    create(data: WorkExperienceMutationData): Promise<WorkExperienceRecord>;
    now?: () => Date;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  const parsedBody = await readRequestBody(request);
  if (parsedBody.response) return parsedBody.response;

  const parsed = parseCreateWorkExperience(parsedBody.body);
  if (parsed.invalidShape) {
    return jsonResponse({ error: "Invalid work experience data." }, 400);
  }
  if (!parsed.data) {
    return jsonResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  const now = dependencies.now?.() ?? new Date();
  const data: WorkExperienceMutationData = {
    ...parsed.data,
    publishedAt: resolveWorkExperiencePublishedAt(null, parsed.data.status, now),
  };

  try {
    const experience = await dependencies.create(data);
    return jsonResponse({ experience }, 201);
  } catch {
    return jsonResponse({ error: "Unable to create work experience." }, 500);
  }
}

export async function handleWorkExperienceUpdate(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    update(
      id: string,
      patch: WorkExperiencePatchData,
      now: Date,
    ): Promise<WorkExperienceUpdateResult>;
    now?: () => Date;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  if (!WORK_EXPERIENCE_ID_PATTERN.test(id)) {
    return jsonResponse({ error: "Work experience not found." }, 404);
  }

  const parsedBody = await readRequestBody(request);
  if (parsedBody.response) return parsedBody.response;

  const parsed = parseUpdateWorkExperience(parsedBody.body);
  if (parsed.invalidShape) {
    return jsonResponse({ error: "Invalid work experience data." }, 400);
  }
  if (!parsed.data) {
    return jsonResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const result = await dependencies.update(id, parsed.data, dependencies.now?.() ?? new Date());
    if (result.kind === "missing") {
      return jsonResponse({ error: "Work experience not found." }, 404);
    }
    if (result.kind === "invalid") {
      return jsonResponse(
        { error: "Please correct the highlighted fields.", fields: result.errors ?? {} },
        422,
      );
    }
    if (!result.experience) {
      return jsonResponse({ error: "Unable to update work experience." }, 500);
    }
    return jsonResponse({ experience: result.experience }, 200);
  } catch {
    return jsonResponse({ error: "Unable to update work experience." }, 500);
  }
}

export async function handleWorkExperienceDelete(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    delete(id: string): Promise<boolean>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  if (!WORK_EXPERIENCE_ID_PATTERN.test(id)) {
    return jsonResponse({ error: "Work experience not found." }, 404);
  }

  try {
    if (!(await dependencies.delete(id))) {
      return jsonResponse({ error: "Work experience not found." }, 404);
    }
    return jsonResponse({ success: true }, 200);
  } catch {
    return jsonResponse({ error: "Unable to delete work experience." }, 500);
  }
}
