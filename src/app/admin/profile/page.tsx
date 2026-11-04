import "server-only";

import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { validateAdminSession } from "@/lib/auth/session";
import { getPublicSiteProfile } from "@/lib/site-profile";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Profile management",
  robots: { index: false, follow: false },
};

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export default function AdminProfilePage() {
  return (
    <Suspense fallback={<ProfilePageLoading />}>
      <AdminProfileContent />
    </Suspense>
  );
}

async function AdminProfileContent() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateAdminSession(token) : null;

  if (!session) {
    redirect("/admin/login");
  }

  if (session.user.role !== "ADMIN" && session.user.role !== "EDITOR") {
    redirect("/admin/login");
  }

  let profile = null;

  try {
    profile = await getPublicSiteProfile();
  } catch {
    profile = null;
  }

  return (
    <>
      <header className="admin-dashboard__topbar">
        <div>
          <p className="eyebrow">Workspace / Profile</p>
          <h1 id="profile-management-title">Profile management</h1>
          <p className="admin-dashboard__welcome-detail">
            Edit the public profile shown across the website.
          </p>
        </div>
        <span className="admin-dashboard__session-status">
          <span aria-hidden="true" className="status-dot" />
          Signed in
        </span>
      </header>

      {profile ? (
        <ProfileForm initialProfile={profile} />
      ) : (
        <Card className="profile-management__load-error" variant="outlined" role="alert">
          <h2>Profile unavailable</h2>
          <p>
            The existing site profile could not be loaded. No profile was created or changed.
          </p>
        </Card>
      )}
    </>
  );
}

function ProfilePageLoading() {
  return (
    <div aria-busy="true" className="admin-dashboard__loading-page">
      <p className="eyebrow">Loading profile management…</p>
    </div>
  );
}
