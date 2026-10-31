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
import { isSafePublicProjectUrl, PROJECT_ID_PATTERN, parseProjectInput } from "@/lib/project-validation";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!PROJECT_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Project not found." }, 404);
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
  const projectInput = parsed.data;

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const current = await transaction.project.findUnique({
        where: { id },
        select: {
          publishedAt: true,
          links: { select: { url: true } },
          images: { select: { imageUrl: true } },
        },
      });
      if (!current) return { kind: "project-missing" as const };

      if (
        projectInput.status === "PUBLISHED" &&
        (
          (projectInput.links ?? current.links).some((link) => !isSafePublicProjectUrl(link.url)) ||
          (projectInput.images ?? current.images).some((image) => !isSafePublicProjectUrl(image.imageUrl))
        )
      ) {
        return { kind: "unsafe-public-media" as const };
      }

      if (projectInput.categoryId) {
        const category = await transaction.projectCategory.findUnique({
          where: { id: projectInput.categoryId },
          select: { id: true },
        });
        if (!category) return { kind: "category-missing" as const };
      }

      await transaction.project.update({
        where: { id },
        data: {
          ...projectScalarData(projectInput),
          publishedAt:
            projectInput.status === "PUBLISHED" ? (current.publishedAt ?? new Date()) : null,
        },
      });

      await syncProjectRelations(transaction, id, projectInput);
      const project = await transaction.project.findUniqueOrThrow({
        where: { id },
        select: adminProjectSelect,
      });

      return { kind: "updated" as const, project };
    });

    if (result.kind === "project-missing") {
      return adminContentResponse({ error: "Project not found." }, 404);
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
          fields: { links: "Use HTTPS links before publishing.", images: "Use HTTPS images before publishing." },
        },
        422,
      );
    }

    return adminContentResponse({ project: result.project }, 200);
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorizationError = await authorizeAdminContentWrite(request, false);
  if (authorizationError) return authorizationError;

  const { id } = await context.params;
  if (!PROJECT_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Project not found." }, 404);
  }

  try {
    await prisma.project.delete({ where: { id } });
    return adminContentResponse({ success: true }, 200);
  } catch (error) {
    if (getPrismaErrorCode(error) === "P2025") {
      return adminContentResponse({ error: "Project not found." }, 404);
    }
    return adminContentResponse({ error: "Unable to delete the project." }, 500);
  }
}
