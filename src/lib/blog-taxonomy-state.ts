import type { AdminBlogCategory, AdminBlogPostItem, AdminBlogTag } from "@/lib/blog-types";

export function upsertAdminBlogCategory(
  categories: AdminBlogCategory[],
  category: AdminBlogCategory,
): AdminBlogCategory[] {
  return [...categories.filter((item) => item.id !== category.id), category]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export function upsertAdminBlogTag(tags: AdminBlogTag[], tag: AdminBlogTag): AdminBlogTag[] {
  return [...tags.filter((item) => item.id !== tag.id), tag]
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function syncBlogPostCategoryLabel(
  posts: AdminBlogPostItem[],
  category: AdminBlogCategory,
): AdminBlogPostItem[] {
  return posts.map((post) => post.categoryId === category.id
    ? { ...post, category: { id: category.id, name: category.name } }
    : post);
}

export function removeBlogCategoryFromPosts(
  posts: AdminBlogPostItem[],
  categoryId: string,
): AdminBlogPostItem[] {
  return posts.map((post) => post.categoryId === categoryId
    ? { ...post, categoryId: null, category: null }
    : post);
}

export function syncBlogPostTagLabel(posts: AdminBlogPostItem[], tag: AdminBlogTag): AdminBlogPostItem[] {
  return posts.map((post) => ({
    ...post,
    tags: post.tags.map((item) => item.id === tag.id ? { id: tag.id, name: tag.name } : item),
  }));
}

export function removeBlogTagFromPosts(posts: AdminBlogPostItem[], tagId: string): AdminBlogPostItem[] {
  return posts.map((post) => ({ ...post, tags: post.tags.filter((tag) => tag.id !== tagId) }));
}

export function getBlogPostEditorRelations(post: AdminBlogPostItem | null): {
  categoryId: string;
  tagIds: string[];
} {
  return {
    categoryId: post?.categoryId ?? "",
    tagIds: post?.tags.map(({ id }) => id) ?? [],
  };
}
