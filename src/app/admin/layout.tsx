import "server-only";

import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { AdminUnsavedNavigationGuard } from "@/components/admin/admin-unsaved-navigation-guard";
import { validateAdminSession } from "@/lib/auth/session";
import { logAdminAuthDiagnostic } from "@/lib/auth/auth-diagnostics";
import { AdminSidebar } from "./admin-sidebar";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

// Session validation may redirect, so this protected segment is allowed to block
// instead of being checked for instant UI during development.
export const instant = false;

// Keep /admin/login in a sibling route group outside app/admin so it skips this guard.
interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AdminUnsavedNavigationGuard />
      </Suspense>
      <Suspense fallback={null}>
        <RequireAdminSession>{children}</RequireAdminSession>
      </Suspense>
    </>
  );
}

async function RequireAdminSession({ children }: AdminLayoutProps) {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    logAdminAuthDiagnostic({
      boundary: "admin-layout",
      outcome: "rejected",
      source: "admin-layout",
      reason: "missing-cookie",
      phase: "session-lookup",
    });
  }

  const session = token ? await validateAdminSession(token, "admin-layout") : null;

  if (!session) {
    redirect("/admin/login");
  }

  return (
    <div className="admin-dashboard">
      <Container className="admin-dashboard__container">
        <div className="admin-dashboard__shell">
          <Suspense fallback={<AdminSidebarLoading />}>
            <AdminSidebar email={session.user.email} role={session.user.role} />
          </Suspense>
          <div
            className="admin-dashboard__main"
            id="admin-main"
            tabIndex={-1}
          >
            {children}
          </div>
        </div>
      </Container>
    </div>
  );
}

function AdminSidebarLoading() {
  return (
    <aside aria-busy="true" className="admin-dashboard__sidebar admin-dashboard__sidebar--loading">
      <span className="eyebrow">Loading workspace navigation…</span>
    </aside>
  );
}
