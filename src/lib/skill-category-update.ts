import {
  createCategorySlug,
  parseUpdateSkillCategory,
  SKILL_CATEGORY_ID_PATTERN,
  type CategoryInputData,
} from "@/lib/skill-validation";
import type { SkillCategoryItem } from "@/lib/skill-types";

export type SkillCategoryUpdateData = CategoryInputData & { slug: string };
export type SkillCategoryUpdater = (
  id: string,
  data: SkillCategoryUpdateData,
) => Promise<SkillCategoryItem>;

function adminContentResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

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

function logCategoryUpdateFailure(error: unknown): void {
  if (process.env.NODE_ENV !== "development") return;

  console.error("Admin skill category update failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    prismaCode: getPrismaErrorCode(error),
  });
}

export async function updateSkillCategory(
  id: string,
  body: unknown,
  update: SkillCategoryUpdater,
): Promise<Response> {
  if (!SKILL_CATEGORY_ID_PATTERN.test(id)) {
    return adminContentResponse({ error: "Category not found." }, 404);
  }

  const parsed = parseUpdateSkillCategory(body);
  if (parsed.invalidShape) {
    return adminContentResponse({ error: "Invalid category data." }, 400);
  }
  if (!parsed.data) {
    return adminContentResponse(
      { error: "Please correct the highlighted fields.", fields: parsed.errors },
      422,
    );
  }

  const slug = createCategorySlug(parsed.data.name);
  if (!slug) {
    return adminContentResponse(
      {
        error: "Please correct the highlighted fields.",
        fields: { name: "Use a category name that can form a short URL slug." },
      },
      422,
    );
  }

  try {
    const category = await update(id, { ...parsed.data, slug });
    return adminContentResponse({ category }, 200);
  } catch (error) {
    const code = getPrismaErrorCode(error);
    logCategoryUpdateFailure(error);

    if (code === "P2002") {
      return adminContentResponse(
        { error: "A category with this name or generated URL already exists." },
        409,
      );
    }
    if (code === "P2025") {
      return adminContentResponse({ error: "Category not found." }, 404);
    }

    return adminContentResponse({ error: "Unable to update the category." }, 500);
  }
}
