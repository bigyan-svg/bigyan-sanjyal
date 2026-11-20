import {
  adminContentResponse,
  authorizeAdminContentReadRequest,
} from "@/lib/auth/admin-content-session";
import type {
  PreviewDatabaseIdentity,
  PreviewDatabaseIdentityResult,
} from "./preview-database-identity";

export interface PreviewDatabaseIdentityHandlerDependencies {
  environment: string | undefined;
  runDiagnostic: (token: string) => Promise<PreviewDatabaseIdentityResult>;
}

export function createPreviewDatabaseIdentityHandler(
  dependencies: PreviewDatabaseIdentityHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (dependencies.environment !== "preview") {
      return adminContentResponse({ error: "Not found." }, 404);
    }

    if (request.method !== "GET") {
      return adminContentResponse(
        { error: "Method not allowed." },
        405,
        { Allow: "GET" },
      );
    }

    let identity: PreviewDatabaseIdentity | null = null;
    const authorizationResponse = await authorizeAdminContentReadRequest(
      request,
      async (token) => {
        const result = await dependencies.runDiagnostic(token);
        if (result.kind === "unauthenticated") return null;
        if (result.kind === "non-admin") {
          return { user: { role: "NOT_ADMIN" } };
        }

        identity = result.identity;
        return { user: { role: "ADMIN" } };
      },
    );

    if (authorizationResponse) return authorizationResponse;
    if (!identity) {
      return adminContentResponse(
        { error: "Unable to inspect database identity." },
        500,
      );
    }

    return adminContentResponse(identity, 200);
  };
}
