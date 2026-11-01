import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  readPublicBlogListing,
  readPublishedBlogPostBySlug,
  readPublishedBlogPosts,
  type BlogListingSearchParams,
} from "@/lib/public-blog-query";

export type {
  BlogListingFilters,
  BlogListingSearchParams,
  PublicBlogCategory,
  PublicBlogArticle,
  PublicBlogPost,
  PublicBlogListingResult,
  PublicBlogTag,
  PublishedBlogArticleResult,
  PublishedBlogPostsResult,
} from "@/lib/public-blog-query";

export function getPublishedBlogPosts() {
  return readPublishedBlogPosts((query) => prisma.post.findMany(query));
}

export function getPublicBlogListing(searchParams: BlogListingSearchParams) {
  return readPublicBlogListing(searchParams, {
    findPosts: (query) => prisma.post.findMany(query),
    countPosts: (where) => prisma.post.count({ where }),
    findCategories: (query) => prisma.postCategory.findMany(query),
    findTags: (query) => prisma.tag.findMany(query),
  });
}

export const getPublishedBlogPostBySlug = cache((slug: string) =>
  readPublishedBlogPostBySlug(slug, (query) => prisma.post.findFirst(query)),
);
