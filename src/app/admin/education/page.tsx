import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateAdminSession } from "@/lib/auth/session";
import { isAuthorizedEducationSession } from "@/lib/education-access";
import { EducationManager } from "./education-manager";

export const metadata: Metadata = {
  title: "Education management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminEducationPage() {
  return (
    <Suspense fallback={<EducationPageLoading />}>
      <AdminEducationContent />
    </Suspense>
  );
}

async function AdminEducationContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!isAuthorizedEducationSession(session)) {
    redirect("/admin/login");
  }

  return (
    <>
      <header className="admin-dashboard__topbar">
        <div>
          <p className="eyebrow">Workspace / Education</p>
          <h1 id="education-management-title">Education management</h1>
          <p className="admin-dashboard__welcome-detail">
            Manage academic details and choose which records are published.
          </p>
        </div>
        <span className="admin-dashboard__session-status">
          <span aria-hidden="true" className="status-dot" />
          Signed in
        </span>
      </header>

      <EducationManager />
    </>
  );
}

function EducationPageLoading() {
  return (
    <div aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading Education management…</p>
    </div>
  );
}
