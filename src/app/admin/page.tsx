import "server-only";

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  FileText,
  FolderKanban,
  GraduationCap,
  Mail,
  Settings,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { DashboardStatistics } from "./dashboard-statistics";
import { loadAdminDashboardStatistics } from "@/lib/admin-dashboard-statistics";
import { ADMIN_DASHBOARD_STATISTIC_KEYS } from "@/lib/admin-dashboard-statistics-types";
import { validateAdminSession } from "@/lib/auth/session";
import { logAdminAuthDiagnostic } from "@/lib/auth/auth-diagnostics";

export const metadata: Metadata = {
  title: "Admin dashboard",
  robots: {
    index: false,
    follow: false,
  },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const dashboardQuickLinks: {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}[] = [
  { label: "Profile", description: "Update public profile details.", href: "/admin/profile", icon: UserRound },
  { label: "Projects", description: "Manage project records and publication.", href: "/admin/projects", icon: FolderKanban },
  { label: "Skills", description: "Manage skills and categories.", href: "/admin/skills", icon: Wrench },
  { label: "Blog posts", description: "Write and organize blog posts.", href: "/admin/blog", icon: FileText },
  { label: "Education", description: "Manage academic records.", href: "/admin/education", icon: GraduationCap },
  { label: "Work experience", description: "Manage experience records.", href: "/admin/experience", icon: BriefcaseBusiness },
  { label: "Messages", description: "Review contact form submissions.", href: "/admin/messages", icon: Mail },
  { label: "Settings", description: "Change the admin account password.", href: "/admin/settings", icon: Settings },
];

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={<DashboardPageLoading />}>
      <AdminDashboardContent />
    </Suspense>
  );
}

async function AdminDashboardContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    logAdminAuthDiagnostic({
      boundary: "admin-dashboard",
      outcome: "rejected",
      source: "admin-dashboard",
      reason: "missing-cookie",
      phase: "session-lookup",
    });
  }

  const session = token ? await validateAdminSession(token, "admin-dashboard") : null;

  if (!session) {
    redirect("/admin/login");
  }

  const roleLabel = session.user.role === "ADMIN" ? "Administrator" : "Editor";

  return (
    <>
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

      <section aria-labelledby="admin-getting-started-title" className="admin-dashboard__getting-started">
        <div className="admin-dashboard__section-heading">
          <div>
            <p className="eyebrow">Getting started</p>
            <h2 id="admin-getting-started-title">Choose an area to manage</h2>
          </div>
          <p>Open a workspace to review or update its records.</p>
        </div>
        <div className="admin-dashboard__quick-links">
          {dashboardQuickLinks.map((item) => (
            <Card className="admin-dashboard__quick-link-card" key={item.href} variant="outlined">
              <Link href={item.href}>
                <item.icon aria-hidden="true" className="admin-dashboard__quick-link-icon" size={17} />
                <span className="admin-dashboard__quick-link-copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </span>
                <ArrowUpRight aria-hidden="true" className="admin-dashboard__quick-link-arrow" size={16} />
              </Link>
            </Card>
          ))}
        </div>
      </section>
    </>
  );
}

async function DashboardSummary() {
  const statistics = await loadAdminDashboardStatistics(ADMIN_DASHBOARD_STATISTIC_KEYS);
  return <DashboardStatistics initialStatistics={statistics} />;
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
