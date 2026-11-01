import type { ContentStatus } from "@/generated/prisma/client";

export interface AdminBlogCategoryOption {
  id: string;
  name: string;
}

export interface AdminBlogCategory extends AdminBlogCategoryOption {
  slug: string;
  description: string | null;
  sortOrder: number;
  postCount: number;
}

export interface AdminBlogTagOption {
  id: string;
  name: string;
}

export interface AdminBlogTag extends AdminBlogTagOption {
  slug: string;
  postCount: number;
}

export interface AdminBlogPostItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  status: ContentStatus;
  publishedAt: string | null;
  categoryId: string | null;
  category: AdminBlogCategoryOption | null;
  tags: AdminBlogTagOption[];
  createdAt: string;
  updatedAt: string;
}
