import "server-only";

import {
  JsonRequestTooLargeError,
  readJsonRequest,
} from "./json-request";
import {
  isValidSocialLinkId,
  parseCreateSocialLink,
  parseSocialLinkPatch,
  parseSocialLinkReorder,
  type AdminSocialLink,
  type SocialLinkFieldErrors,
  type SocialLinkInput,
  type SocialLinkPatch,
} from "./profile-social-validation";
import {
  SocialLinkOrderConflictError,
  SocialLinkWriteConflictError,
} from "./profile-social-content";

export const PROFILE_SOCIAL_LINKS_REQUEST_MAX_BYTES = 16 * 1024;

function response(body: unknown, status: number): Response {
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
    return response({ error: "Unable to authorize this request." }, 500);
  }
}

async function readBody(request: Request): Promise<
  | { body: unknown; error: null }
  | { body: null; error: Response }
> {
  try {
    return {
      body: await readJsonRequest(request, PROFILE_SOCIAL_LINKS_REQUEST_MAX_BYTES),
      error: null,
    };
  } catch (error) {
    return {
      body: null,
      error: error instanceof JsonRequestTooLargeError
        ? response({ error: "Request body is too large." }, 413)
        : response({ error: "Invalid request." }, 400),
    };
  }
}

export async function handleSocialLinkList(
  request: Request,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    findAll(): Promise<AdminSocialLink[]>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  try {
    return response({ links: await dependencies.findAll() }, 200);
  } catch {
    return response({ error: "Unable to load social links." }, 500);
  }
}

export async function handleSocialLinkCreate(
  request: Request,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    create(data: SocialLinkInput): Promise<AdminSocialLink | null>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  const parsedBody = await readBody(request);
  if (parsedBody.error) return parsedBody.error;

  const parsed = parseCreateSocialLink(parsedBody.body);
  if (parsed.invalidShape) return response({ error: "Invalid social link data." }, 400);
  if (!parsed.data) {
    return response(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const link = await dependencies.create(parsed.data);
    if (!link) {
      return response({ error: "The social link limit or ordering limit has been reached." }, 409);
    }
    return response({ link }, 201);
  } catch (error) {
    if (error instanceof SocialLinkWriteConflictError) {
      return response({ error: "The social links changed. Refresh and try again." }, 409);
    }
    return response({ error: "Unable to create the social link." }, 500);
  }
}

export type SocialLinkUpdateResult =
  | { kind: "missing" }
  | { kind: "invalid"; errors: SocialLinkFieldErrors }
  | { kind: "updated"; link: AdminSocialLink };

export async function handleSocialLinkUpdate(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    update(id: string, patch: SocialLinkPatch): Promise<SocialLinkUpdateResult>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  if (!isValidSocialLinkId(id)) return response({ error: "Social link not found." }, 404);

  const parsedBody = await readBody(request);
  if (parsedBody.error) return parsedBody.error;

  const parsed = parseSocialLinkPatch(parsedBody.body);
  if (parsed.invalidShape) return response({ error: "Invalid social link data." }, 400);
  if (!parsed.data) {
    return response(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  try {
    const result = await dependencies.update(id, parsed.data);
    if (result.kind === "missing") return response({ error: "Social link not found." }, 404);
    if (result.kind === "invalid") {
      return response(
        { error: "Please correct the highlighted fields.", fields: result.errors },
        422,
      );
    }
    return response({ link: result.link }, 200);
  } catch {
    return response({ error: "Unable to update the social link." }, 500);
  }
}

export async function handleSocialLinkDelete(
  request: Request,
  id: string,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    delete(id: string): Promise<boolean>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  if (!isValidSocialLinkId(id)) return response({ error: "Social link not found." }, 404);

  try {
    if (!(await dependencies.delete(id))) {
      return response({ error: "Social link not found." }, 404);
    }
    return response({ success: true }, 200);
  } catch (error) {
    if (error instanceof SocialLinkWriteConflictError) {
      return response({ error: "The social links changed. Refresh and try again." }, 409);
    }
    return response({ error: "Unable to delete the social link." }, 500);
  }
}

export async function handleSocialLinkReorder(
  request: Request,
  dependencies: {
    authorize(request: Request): Promise<Response | null>;
    reorder(ids: string[]): Promise<boolean>;
  },
): Promise<Response> {
  const authorizationError = await getAuthorizationError(request, dependencies.authorize);
  if (authorizationError) return authorizationError;

  const parsedBody = await readBody(request);
  if (parsedBody.error) return parsedBody.error;

  const ids = parseSocialLinkReorder(parsedBody.body);
  if (!ids) return response({ error: "Invalid social link order." }, 400);

  try {
    if (!(await dependencies.reorder(ids))) {
      return response({ error: "The social links changed. Refresh and try again." }, 409);
    }
    return response({ success: true }, 200);
  } catch (error) {
    if (error instanceof SocialLinkOrderConflictError) {
      return response({ error: "The social links changed. Refresh and try again." }, 409);
    }
    return response({ error: "Unable to reorder social links." }, 500);
  }
}
