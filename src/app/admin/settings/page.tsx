import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { validateAdminSession } from "@/lib/auth/session";
import { isAdminSettingsRole } from "@/lib/admin-settings-access";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = {
  title: "Security settings",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminSettingsPage() {
  return (
    <Suspense fallback={<SettingsPageLoading />}>
      <AdminSettingsContent />
    </Suspense>
  );
}

async function AdminSettingsContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session || !isAdminSettingsRole(session.user.role)) {
    redirect("/admin/login");
  }

  return (
    <>
      <header className="admin-dashboard__topbar">
        <div>
          <p className="eyebrow">Workspace / Settings</p>
          <h1 id="admin-settings-title">Security settings</h1>
          <p className="admin-dashboard__welcome-detail">
            Update the password for your administrator account.
          </p>
        </div>
        <span className="admin-dashboard__session-status">
          <span aria-hidden="true" className="status-dot" />
          Signed in
        </span>
      </header>

      <div className="admin-settings__content">
        <Card className="admin-settings__card" variant="outlined">
          <div className="admin-settings__intro">
            <div>
              <p className="eyebrow">Account security</p>
              <h2>Change password</h2>
            </div>
            <p>Choose a unique password that you do not use for another account.</p>
          </div>

          <div className="admin-settings__session-notice" role="note">
            <strong>Active sessions will be signed out</strong>
            <p>
              Changing your password revokes all active admin sessions, including this
              one. You will need to sign in again with your new password.
            </p>
          </div>

          <SettingsForm />
        </Card>
      </div>
    </>
  );
}

function SettingsPageLoading() {
  return (
    <div aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow" role="status">Loading security settings…</p>
    </div>
  );
}
