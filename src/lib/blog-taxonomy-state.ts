import type { AffectedBlogPostVersion, AdminBlogCategory, AdminBlogPostItem, AdminBlogTag } from "@/lib/blog-types";

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
  affectedPosts: AffectedBlogPostVersion[],
): AdminBlogPostItem[] {
  const versions = new Map(affectedPosts.map(({ id, version }) => [id, version]));
  return posts.map((post) => {
    const version = versions.get(post.id);
    const detached = post.categoryId === categoryId;
    if (version === undefined && !detached) return post;
    return {
      ...post,
      ...(version === undefined ? {} : { version }),
      ...(detached ? { categoryId: null, category: null } : {}),
    };
  });
}

export function syncBlogPostTagLabel(posts: AdminBlogPostItem[], tag: AdminBlogTag): AdminBlogPostItem[] {
  return posts.map((post) => ({
    ...post,
    tags: post.tags.map((item) => item.id === tag.id ? { id: tag.id, name: tag.name } : item),
  }));
}

export function removeBlogTagFromPosts(
  posts: AdminBlogPostItem[],
  tagId: string,
  affectedPosts: AffectedBlogPostVersion[],
): AdminBlogPostItem[] {
  const versions = new Map(affectedPosts.map(({ id, version }) => [id, version]));
  return posts.map((post) => {
    const version = versions.get(post.id);
    const tags = post.tags.filter((tag) => tag.id !== tagId);
    if (version === undefined && tags.length === post.tags.length) return post;
    return {
      ...post,
      ...(version === undefined ? {} : { version }),
      tags,
    };
  });
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
