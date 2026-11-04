import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminDataLoadError } from "@/components/admin/admin-data-load-error";
import { validateAdminSession } from "@/lib/auth/session";
import { adminBlogPostSelect, toAdminBlogPostItem } from "@/lib/blog-content";
import {
  adminBlogCategorySelect,
  adminBlogTagSelect,
  toAdminBlogCategory,
  toAdminBlogTag,
} from "@/lib/blog-taxonomy-content";
import type { AdminBlogCategory, AdminBlogTag } from "@/lib/blog-types";
import { prisma } from "@/lib/prisma";
import { BlogManager } from "./blog-manager";

export const metadata: Metadata = {
  title: "Blog post management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminBlogPage() {
  return (
    <Suspense fallback={<BlogPageLoading />}>
      <AdminBlogContent />
    </Suspense>
  );
}

async function AdminBlogContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;
  if (!session || (session.user.role !== "ADMIN" && session.user.role !== "EDITOR")) {
    redirect("/admin/login");
  }

  let posts: ReturnType<typeof toAdminBlogPostItem>[] = [];
  let categories: AdminBlogCategory[] = [];
  let tags: AdminBlogTag[] = [];
  let loadFailed = false;

  try {
    const [postRecords, categoryRecords, tagRecords] = await Promise.all([
      prisma.post.findMany({
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }, { id: "asc" }],
        select: adminBlogPostSelect,
      }),
      prisma.postCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: adminBlogCategorySelect,
      }),
      prisma.tag.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: adminBlogTagSelect,
      }),
    ]);
    posts = postRecords.map(toAdminBlogPostItem);
    categories = categoryRecords.map(toAdminBlogCategory);
    tags = tagRecords.map(toAdminBlogTag);
  } catch {
    loadFailed = true;
  }

  return (
    <>
      <header className="admin-dashboard__topbar">
        <div>
          <p className="eyebrow">Workspace / Blog</p>
          <h1 id="blog-management-title">Blog post management</h1>
          <p className="admin-dashboard__welcome-detail">
            Write and organize posts, then choose when they are published.
          </p>
        </div>
        <span className="admin-dashboard__session-status">
          <span aria-hidden="true" className="status-dot" />
          Signed in
        </span>
      </header>

      {loadFailed ? (
        <AdminDataLoadError
          description="Posts, categories, or tags could not be loaded. No content was changed. Try again to reload the management data."
          title="Blog posts and options are unavailable"
        />
      ) : (
        <BlogManager initialCategories={categories} initialPosts={posts} initialTags={tags} />
      )}
    </>
  );
}

function BlogPageLoading() {
  return (
    <div aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading blog management…</p>
    </div>
  );
}
