import type { ContentStatus } from "@/generated/prisma/client";

export interface SkillCategoryItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
}

export interface SkillItem {
  id: string;
  categoryId: string;
  name: string;
  icon: string | null;
  description: string | null;
  proficiencyLabel: string | null;
  status: ContentStatus;
  sortOrder: number;
  category: Pick<SkillCategoryItem, "id" | "name">;
}
