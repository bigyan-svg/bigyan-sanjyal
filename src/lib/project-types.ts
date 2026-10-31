import type { ContentStatus, ProjectLinkType } from "@/generated/prisma/client";

export interface ProjectCategoryOption {
  id: string;
  name: string;
}

export interface AdminProjectCategory extends ProjectCategoryOption {
  slug: string;
  description: string | null;
  sortOrder: number;
  projectCount: number;
}

export interface AdminProjectItem {
  id: string;
  categoryId: string | null;
  title: string;
  slug: string;
  summary: string;
  description: string | null;
  status: ContentStatus;
  featured: boolean;
  sortOrder: number;
  category: ProjectCategoryOption | null;
  skills: Array<{
    skillId: string;
    skill: {
      id: string;
      name: string;
      status: ContentStatus;
      category: { name: string };
    };
  }>;
  links: ProjectLinkItem[];
  images: ProjectImageItem[];
}

export interface ProjectLinkItem {
  id: string;
  type: ProjectLinkType;
  label: string;
  url: string;
  sortOrder: number;
}

export interface ProjectImageItem {
  id: string;
  imageUrl: string;
  altText: string;
  caption: string | null;
  sortOrder: number;
}

export interface AdminProjectSkillOption {
  id: string;
  name: string;
  status: ContentStatus;
  categoryName: string;
}
