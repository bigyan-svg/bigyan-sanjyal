import "server-only";

import { Suspense, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateAdminSession } from "@/lib/auth/session";

const ADMIN_SESSION_COOKIE_NAME = "admin_session";

// Keep /admin/login in a sibling route group outside app/admin so it skips this guard.
interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <Suspense fallback={null}>
      <RequireAdminSession>{children}</RequireAdminSession>
    </Suspense>
  );
}

async function RequireAdminSession({ children }: AdminLayoutProps) {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE_NAME)?.value;

  if (!token || !(await validateAdminSession(token))) {
    redirect("/admin/login");
  }

  return children;
}
