import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateAdminSession } from "@/lib/auth/session";
import { isAuthorizedWorkExperienceSession } from "@/lib/work-experience-access";
import { WorkExperienceManager } from "./experience-manager";

export const metadata: Metadata = {
  title: "Work Experience management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminExperiencePage() {
  return (
    <Suspense fallback={<ExperiencePageLoading />}>
      <AdminExperienceContent />
    </Suspense>
  );
}

async function AdminExperienceContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!isAuthorizedWorkExperienceSession(session)) {
    redirect("/admin/login");
  }

  return (
    <>
      <header className="admin-dashboard__topbar">
        <div>
          <p className="eyebrow">Workspace / Work Experience</p>
          <h1 id="experience-management-title">Work Experience management</h1>
          <p className="admin-dashboard__welcome-detail">
            Manage employment details and choose which records are published.
          </p>
        </div>
        <span className="admin-dashboard__session-status">
          <span aria-hidden="true" className="status-dot" />
          Signed in
        </span>
      </header>

      <WorkExperienceManager />
    </>
  );
}

function ExperiencePageLoading() {
  return (
    <div aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading Work Experience management…</p>
    </div>
  );
}
