import "server-only";

import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { validateAdminSession } from "@/lib/auth/session";
import type { SkillCategoryItem, SkillItem } from "@/lib/skill-types";
import { AdminSidebar } from "../admin-sidebar";
import { SkillsManager } from "./skills-manager";

export const metadata: Metadata = {
  title: "Skills management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

const skillSelect = {
  id: true,
  categoryId: true,
  name: true,
  icon: true,
  description: true,
  proficiencyLabel: true,
  status: true,
  sortOrder: true,
  category: { select: { id: true, name: true } },
} satisfies Prisma.SkillSelect;

export default function AdminSkillsPage() {
  return (
    <Suspense fallback={<SkillsPageLoading />}>
      <AdminSkillsContent />
    </Suspense>
  );
}

async function AdminSkillsContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session) redirect("/admin/login");
  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    redirect("/admin/login");
  }

  let categories: SkillCategoryItem[] | null = null;
  let skills: SkillItem[] | null = null;
  let loadFailed = false;

  try {
    [categories, skills] = await Promise.all([
      prisma.skillCategory.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true, description: true, sortOrder: true },
      }),
      prisma.skill.findMany({
        orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: skillSelect,
      }),
    ]);
  } catch {
    loadFailed = true;
  }

  return (
    <section aria-labelledby="skills-management-title" className="admin-dashboard">
      <Container className="admin-dashboard__container">
        <div className="admin-dashboard__shell">
          <AdminSidebar
            activeHref="/admin/skills"
            email={session.user.email}
            role={session.user.role}
          />

          <div className="admin-dashboard__main">
            <header className="admin-dashboard__topbar">
              <div>
                <p className="eyebrow">Workspace / Skills</p>
                <h1 id="skills-management-title">Skills management</h1>
                <p className="admin-dashboard__welcome-detail">
                  Add only skills and proficiency details you want to publish.
                </p>
              </div>
              <span className="admin-dashboard__session-status">
                <span aria-hidden="true" className="status-dot" />
                Signed in
              </span>
            </header>

            {loadFailed ? (
              <Card className="skill-management__load-error" variant="outlined" role="alert">
                <h2>Skills are unavailable</h2>
                <p>Please try loading this page again. No content was changed.</p>
              </Card>
            ) : (
              <SkillsManager initialCategories={categories ?? []} initialSkills={skills ?? []} />
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}

function SkillsPageLoading() {
  return (
    <section aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow">Loading skills management…</p>
    </section>
  );
}
