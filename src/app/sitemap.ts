import type { MetadataRoute } from "next";
import { getPublishedBlogPosts } from "@/lib/public-blog";

const SITE_URL = "https://bigyansanjyal.com.np";

const publicRoutes = [
  "",
  "/about",
  "/projects",
  "/blog",
  "/contact",
  "/education",
  "/experience",
  "/skills",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = publicRoutes.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));

  const result = await getPublishedBlogPosts();

  const blogEntries: MetadataRoute.Sitemap =
    result.kind === "success"
      ? result.posts.map((post) => ({
          url: `${SITE_URL}/blog/${post.slug}`,
          ...(post.publishedAt
            ? { lastModified: post.publishedAt }
            : {}),
          changeFrequency: "monthly",
          priority: 0.6,
        }))
      : [];

  return [...staticEntries, ...blogEntries];
}
