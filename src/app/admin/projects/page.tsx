import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { validateAdminSession } from "@/lib/auth/session";
import type {
  AdminProjectCategory,
  AdminProjectItem,
  AdminProjectSkillOption,
} from "@/lib/project-types";
import { adminProjectSelect } from "@/lib/project-content";
import { AdminSidebar } from "../admin-sidebar";
import { ProjectsManager } from "./projects-manager";

export const metadata: Metadata = {
  title: "Projects management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminProjectsPage() {
  return (
    <Suspense fallback={<ProjectsPageLoading />}>
      <AdminProjectsContent />
    </Suspense>
  );
}

async function AdminProjectsContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session) redirect("/admin/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    redirect("/admin/login");
  }

  let projects: AdminProjectItem[] | null = null;
  let categories: AdminProjectCategory[] | null = null;
  let skills: AdminProjectSkillOption[] | null = null;
  let loadFailed = false;

  try {
    [projects, categories, skills] = await Promise.all([
      prisma.project.findMany({
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
        select: adminProjectSelect,
      }),
      prisma.projectCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          sortOrder: true,
          _count: { select: { projects: true } },
        },
      }).then((items) => items.map(({ _count, ...category }) => ({
        ...category,
        projectCount: _count.projects,
      }))),
      prisma.skill.findMany({
        orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, status: true, category: { select: { name: true } } },
      }).then((items) => items.map(({ category, ...skill }) => ({
        ...skill,
        categoryName: category.name,
      }))),
    ]);
  } catch {
    loadFailed = true;
  }

  return (
    <section aria-labelledby="projects-management-title" className="admin-dashboard">
      <Container className="admin-dashboard__container">
        <div className="admin-dashboard__shell">
          <AdminSidebar
            activeHref="/admin/projects"
            email={session.user.email}
            role={session.user.role}
          />

          <div className="admin-dashboard__main">
            <header className="admin-dashboard__topbar">
              <div>
                <p className="eyebrow">Workspace / Projects</p>
                <h1 id="projects-management-title">Projects management</h1>
                <p className="admin-dashboard__welcome-detail">
                  Add confirmed project details and choose when each project is published.
                </p>
              </div>
              <span className="admin-dashboard__session-status">
                <span aria-hidden="true" className="status-dot" />
                Signed in
              </span>
            </header>

            {loadFailed ? (
              <Card className="project-management__load-error" variant="outlined" role="alert">
                <h2>Projects and categories are unavailable</h2>
                <p>Please try loading this page again. No content was changed.</p>
              </Card>
            ) : (
              <ProjectsManager
                initialCategories={categories ?? []}
                initialProjects={projects ?? []}
                initialSkills={skills ?? []}
              />
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function ProjectsPageLoading() {
  return (
    <section aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading projects management…</p>
    </section>
  );
}
