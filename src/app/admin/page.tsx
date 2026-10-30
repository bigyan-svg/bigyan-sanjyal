import "server-only";

import type { Metadata } from "next";
import {
  FileText,
  FolderKanban,
  LayoutDashboard,
  Mail,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { prisma } from "@/lib/prisma";
import { validateAdminSession } from "@/lib/auth/session";
import { AdminSidebar } from "./admin-sidebar";

export const metadata: Metadata = {
  title: "Admin dashboard",
  robots: {
    index: false,
    follow: false,
  },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<DashboardPageLoading />}>
      <AdminDashboardContent />
    </Suspense>
  );
}

async function AdminDashboardContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session) {
    redirect("/admin/login");
  }

  const roleLabel = session.user.role === "ADMIN" ? "Administrator" : "Editor";

  return (
    <section aria-labelledby="admin-dashboard-title" className="admin-dashboard">
      <Container className="admin-dashboard__container">
        <div className="admin-dashboard__shell">
          <AdminSidebar
            activeHref="/admin"
            email={session.user.email}
            role={session.user.role}
          />

          <div className="admin-dashboard__main">
            <header className="admin-dashboard__topbar">
              <div>
                <p className="eyebrow">Workspace / Overview</p>
                <h1 id="admin-dashboard-title">Welcome, {roleLabel}</h1>
                <p className="admin-dashboard__welcome-detail">
                  Your website content at a glance.
                </p>
              </div>
              <span className="admin-dashboard__session-status">
                <span aria-hidden="true" className="status-dot" />
                Signed in
              </span>
            </header>

            <section aria-labelledby="admin-summary-title" className="admin-dashboard__summary">
              <div className="admin-dashboard__section-heading">
                <div>
                  <p className="eyebrow">Live overview</p>
                  <h2 id="admin-summary-title">Content summary</h2>
                </div>
                <p>Counts reflect records currently stored in the database.</p>
              </div>

              <Suspense fallback={<SummaryLoading />}>
                <DashboardSummary />
              </Suspense>
            </section>

            <Card className="admin-dashboard__notice" variant="outlined">
              <span aria-hidden="true" className="admin-dashboard__notice-mark">
                <LayoutDashboard size={18} />
              </span>
              <div>
                <p className="eyebrow">Getting started</p>
                <h2>Your workspace is ready to grow.</h2>
                <p>
                  The sections marked “Soon” will become available as their
                  management tools are built.
                </p>
              </div>
            </Card>
          </div>
        </div>
      </Container>
    </section>
  );
}

async function DashboardSummary() {
  let summary: {
    projectCount: number;
    postCount: number;
    skillCount: number;
    newMessageCount: number;
  } | null = null;

  try {
    const [projectCount, postCount, skillCount, newMessageCount] = await Promise.all([
      prisma.project.count(),
      prisma.post.count(),
      prisma.skill.count(),
      prisma.contactMessage.count({ where: { status: "NEW" } }),
    ]);

    summary = { projectCount, postCount, skillCount, newMessageCount };
  } catch {
    summary = null;
  }

  if (!summary) {
    return (
      <p className="admin-dashboard__summary-error" role="status">
        Summary counts are temporarily unavailable.
      </p>
    );
  }

  return (
    <div className="admin-dashboard__stat-grid">
      <SummaryCard
        count={summary.projectCount}
        emptyText="No projects have been added yet."
        icon={FolderKanban}
        label="Projects"
        plural="projects"
        singular="project"
      />
      <SummaryCard
        count={summary.postCount}
        emptyText="No blog posts have been added yet."
        icon={FileText}
        label="Blog posts"
        plural="posts"
        singular="post"
      />
      <SummaryCard
        count={summary.skillCount}
        emptyText="No skills have been added yet."
        icon={Wrench}
        label="Skills"
        plural="skills"
        singular="skill"
      />
      <SummaryCard
        count={summary.newMessageCount}
        emptyText="There are no new messages."
        icon={Mail}
        label="New messages"
        plural="new messages"
        singular="new message"
      />
    </div>
  );
}

function SummaryCard({
  count,
  emptyText,
  icon: Icon,
  label,
  plural,
  singular,
}: {
  count: number;
  emptyText: string;
  icon: LucideIcon;
  label: string;
  plural: string;
  singular: string;
}) {
  const detail =
    count === 0
      ? emptyText
      : `${count.toLocaleString()} ${count === 1 ? singular : plural} in the workspace.`;

  return (
    <Card className="admin-dashboard__stat-card" variant="outlined">
      <div className="admin-dashboard__stat-heading">
        <p className="eyebrow">{label}</p>
        <span aria-hidden="true" className="admin-dashboard__stat-icon">
          <Icon size={17} />
        </span>
      </div>
      <p className="admin-dashboard__stat-value">{count.toLocaleString()}</p>
      <p className="admin-dashboard__stat-detail">{detail}</p>
    </Card>
  );
}

function SummaryLoading() {
  return (
    <p className="admin-dashboard__summary-loading" role="status">
      Loading current totals…
    </p>
  );
}

function DashboardPageLoading() {
  return (
    <section aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow">Loading secure workspace…</p>
    </section>
  );
}
