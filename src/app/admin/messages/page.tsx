import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { validateAdminSession } from "@/lib/auth/session";
import type { AdminMessageStatusFilter } from "@/lib/admin-messages";
import { AdminSidebar } from "../admin-sidebar";
import { MessagesManager } from "./messages-manager";

export const metadata: Metadata = {
  title: "Messages inbox",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";
const MESSAGE_STATUS_FILTERS = ["ALL", "NEW", "READ", "ARCHIVED", "SPAM"] as const;

interface AdminMessagesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function AdminMessagesPage({ searchParams }: AdminMessagesPageProps) {
  return (
    <Suspense fallback={<MessagesPageLoading />}>
      <AdminMessagesContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminMessagesContent({ searchParams }: AdminMessagesPageProps) {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session || (session.user.role !== "ADMIN" && session.user.role !== "EDITOR")) {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const requestedStatus = typeof params.status === "string" ? params.status : "ALL";
  const initialStatus: AdminMessageStatusFilter = MESSAGE_STATUS_FILTERS.some(
    (status) => status === requestedStatus,
  )
    ? requestedStatus as AdminMessageStatusFilter
    : "ALL";
  const requestedPage = typeof params.page === "string" ? params.page : "1";
  const initialPage = /^[1-9]\d{0,8}$/u.test(requestedPage) ? requestedPage : "1";

  return (
    <section aria-labelledby="messages-management-title" className="admin-dashboard">
      <Container className="admin-dashboard__container">
        <div className="admin-dashboard__shell">
          <AdminSidebar
            activeHref="/admin/messages"
            email={session.user.email}
            role={session.user.role}
          />
          <div className="admin-dashboard__main">
            <header className="admin-dashboard__topbar">
              <div>
                <p className="eyebrow">Workspace / Messages</p>
                <h1 id="messages-management-title">Messages inbox</h1>
                <p className="admin-dashboard__welcome-detail">
                  Read and organize messages submitted through the Contact page.
                </p>
              </div>
              <span className="admin-dashboard__session-status">
                <span aria-hidden="true" className="status-dot" />
                Signed in
              </span>
            </header>

            <MessagesManager
              initialPage={initialPage}
              initialStatus={initialStatus}
              key={`${initialStatus}:${initialPage}`}
            />
          </div>
        </div>
      </Container>
    </section>
  );
}

function MessagesPageLoading() {
  return (
    <section aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading messages inbox…</p>
    </section>
  );
}
