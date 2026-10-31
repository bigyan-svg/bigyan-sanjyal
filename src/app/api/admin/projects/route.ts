import "server-only";

import { adminContentResponse, authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { JsonRequestTooLargeError, readJsonRequest } from "@/lib/json-request";
import { prisma } from "@/lib/prisma";
import {
  adminProjectSelect,
  ProjectSkillMissingError,
  projectScalarData,
  syncProjectRelations,
} from "@/lib/project-content";
import { parseProjectInput } from "@/lib/project-validation";

function getPrismaErrorCode(error: unknown): string | null {
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

export async function POST(request: Request): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

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
  const projectInput = parsed.data;

  try {
    const result = await prisma.$transaction(async (transaction) => {
      if (projectInput.categoryId) {
        const category = await transaction.projectCategory.findUnique({
          where: { id: projectInput.categoryId },
          select: { id: true },
        });
        if (!category) return { categoryMissing: true as const };
      }

      const created = await transaction.project.create({
        data: {
          ...projectScalarData(projectInput),
          publishedAt: projectInput.status === "PUBLISHED" ? new Date() : null,
        },
        select: { id: true },
      });

      await syncProjectRelations(transaction, created.id, projectInput);
      const project = await transaction.project.findUniqueOrThrow({
        where: { id: created.id },
        select: adminProjectSelect,
      });

      return { categoryMissing: false as const, project };
    });

    if (result.categoryMissing) {
      return adminContentResponse(
        {
          error: "Please correct the highlighted fields.",
          fields: { categoryId: "Choose an existing category." },
        },
        422,
      );
    }

    return adminContentResponse({ project: result.project }, 201);
  } catch (error) {
    const code = getPrismaErrorCode(error);
    if (error instanceof ProjectSkillMissingError) {
      return adminContentResponse(
        { error: "Please correct the highlighted fields.", fields: { skillIds: "Choose existing skills." } },
        422,
      );
    }
    if (code === "P2002") {
      return adminContentResponse({ error: "A project with this slug already exists." }, 409);
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
    return adminContentResponse({ error: "Unable to create the project." }, 500);
  }
}
