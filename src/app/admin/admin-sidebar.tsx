import Link from "next/link";
import {
  BriefcaseBusiness,
  FileText,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Mail,
  Settings,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AdminRole } from "@/generated/prisma/client";
import { LogoutButton } from "./logout-button";

const navigationItems: {
  label: string;
  icon: LucideIcon;
  href?: string;
}[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/admin" },
  { label: "Profile", icon: UserRound, href: "/admin/profile" },
  { label: "Skills", icon: Wrench, href: "/admin/skills" },
  { label: "Projects", icon: FolderKanban, href: "/admin/projects" },
  { label: "Blog Posts", icon: FileText, href: "/admin/blog" },
  { label: "Education", icon: GraduationCap },
  { label: "Work Experience", icon: BriefcaseBusiness },
  { label: "Messages", icon: Mail },
  { label: "Settings", icon: Settings },
];

export function AdminSidebar({
  activeHref,
  email,
  role,
}: {
  activeHref: string;
  email: string;
  role: AdminRole;
}) {
  const roleLabel = role === "ADMIN" ? "Administrator" : "Editor";

  return (
    <aside aria-label="Admin workspace" className="admin-dashboard__sidebar">
      <Link aria-label="Return to the public website" className="admin-dashboard__brand" href="/">
        <span aria-hidden="true" className="brand__mark">
          BS
        </span>
        <span className="admin-dashboard__brand-copy">
          <strong>Workspace</strong>
          <span>Personal website</span>
        </span>
      </Link>

      <nav aria-label="Dashboard sections" className="admin-dashboard__navigation">
        <p className="admin-dashboard__nav-heading">Workspace</p>
        <ul>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === activeHref;

            return (
              <li key={item.label}>
                {item.href ? (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "admin-dashboard__nav-item",
                      isActive ? "admin-dashboard__nav-item--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    href={item.href}
                  >
                    <Icon aria-hidden="true" size={17} />
                    <span>{item.label}</span>
                  </Link>
                ) : (
                  <span className="admin-dashboard__nav-item admin-dashboard__nav-item--upcoming">
                    <Icon aria-hidden="true" size={17} />
                    <span>{item.label}</span>
                    <small>Soon</small>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="admin-dashboard__sidebar-footer">
        <div className="admin-dashboard__identity">
          <span aria-hidden="true" className="admin-dashboard__avatar">
            {roleLabel.slice(0, 1)}
          </span>
          <span className="admin-dashboard__identity-copy">
            <strong>{roleLabel}</strong>
            <span title={email}>{email}</span>
          </span>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
