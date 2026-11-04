"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BriefcaseBusiness,
  FileText,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Mail,
  Menu,
  Settings,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AdminRole } from "@/generated/prisma/client";
import { useDismissableLayer } from "@/hooks/use-dismissable-layer";
import { isAdminNavigationItemActive } from "@/lib/admin-navigation";
import { LogoutButton } from "./logout-button";

const navigationItems: {
  label: string;
  icon: LucideIcon;
  href: string;
}[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/admin" },
  { label: "Profile", icon: UserRound, href: "/admin/profile" },
  { label: "Skills", icon: Wrench, href: "/admin/skills" },
  { label: "Projects", icon: FolderKanban, href: "/admin/projects" },
  { label: "Blog Posts", icon: FileText, href: "/admin/blog" },
  { label: "Education", icon: GraduationCap, href: "/admin/education" },
  { label: "Work Experience", icon: BriefcaseBusiness, href: "/admin/experience" },
  { label: "Messages", icon: Mail, href: "/admin/messages" },
  { label: "Settings", icon: Settings, href: "/admin/settings" },
];

export function AdminSidebar({ email, role }: { email: string; role: AdminRole }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState({ open: false, pathname });
  const menuOpen = drawer.open && drawer.pathname === pathname;
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const shouldFocusMainAfterNavigation = useRef(false);
  const previousPathname = useRef(pathname);
  const roleLabel = role === "ADMIN" ? "Administrator" : "Editor";

  const setMenuOpen = useCallback((open: boolean) => {
    setDrawer({ open, pathname });
  }, [pathname]);

  const closeMenuAndRestoreFocus = useCallback(() => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, [setMenuOpen]);

  useDismissableLayer({
    enabled: menuOpen,
    insideRefs: [menuButtonRef, sidebarRef],
    onOutsideClick: closeMenuAndRestoreFocus,
    onEscape: closeMenuAndRestoreFocus,
  });

  useEffect(() => {
    if (!menuOpen) return;

    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;

    const shouldFocusMain = shouldFocusMainAfterNavigation.current || drawer.open;
    shouldFocusMainAfterNavigation.current = false;
    if (shouldFocusMain) {
      window.requestAnimationFrame(() => document.getElementById("admin-main")?.focus());
    }
  }, [drawer.open, pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const desktopBreakpoint = window.matchMedia("(min-width: 68.001rem)");
    function closeOnDesktop() {
      if (!desktopBreakpoint.matches) return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => {
        const activeLink = sidebarRef.current?.querySelector<HTMLElement>(
          'a[aria-current="page"]',
        );
        activeLink?.focus();
      });
    }

    desktopBreakpoint.addEventListener("change", closeOnDesktop);
    return () => desktopBreakpoint.removeEventListener("change", closeOnDesktop);
  }, [menuOpen, setMenuOpen]);

  function handleDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;

    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const focusableElements = Array.from(sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleNavigation(href: string) {
    if (!menuOpen) return;
    setMenuOpen(false);

    if (href === "/admin" || href.startsWith("/admin/")) {
      shouldFocusMainAfterNavigation.current = true;
      if (href === pathname) {
        window.requestAnimationFrame(() => document.getElementById("admin-main")?.focus());
        shouldFocusMainAfterNavigation.current = false;
      }
      return;
    }

    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".site-header__bar .brand")?.focus();
    });
  }

  return (
    <>
      <div className="admin-dashboard__mobile-header">
        <Link
          aria-label="Return to the public website"
          className="admin-dashboard__mobile-brand"
          href="/"
          onClick={() => handleNavigation("/")}
        >
          <span aria-hidden="true" className="brand__mark">BS</span>
          <span>
            <strong>Workspace</strong>
            <small>Personal website</small>
          </span>
        </Link>
        <button
          aria-controls="admin-navigation-drawer"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close admin navigation" : "Open admin navigation"}
          className="admin-dashboard__mobile-toggle"
          onClick={() => menuOpen ? closeMenuAndRestoreFocus() : setMenuOpen(true)}
          ref={menuButtonRef}
          type="button"
        >
          {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>
      </div>

      {menuOpen ? (
        <button
          aria-label="Close admin navigation"
          className="admin-dashboard__backdrop"
          onClick={closeMenuAndRestoreFocus}
          tabIndex={-1}
          type="button"
        />
      ) : null}

      <aside
        aria-label={menuOpen ? "Admin navigation menu" : "Admin workspace"}
        aria-modal={menuOpen ? true : undefined}
        className="admin-dashboard__sidebar"
        data-open={menuOpen}
        id="admin-navigation-drawer"
        onKeyDown={menuOpen ? handleDrawerKeyDown : undefined}
        ref={sidebarRef}
        role={menuOpen ? "dialog" : undefined}
      >
        <div className="admin-dashboard__drawer-heading">
          <span>Workspace navigation</span>
          <button
            aria-label="Close admin navigation"
            className="admin-dashboard__drawer-close"
            onClick={closeMenuAndRestoreFocus}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
        </div>

        <Link
          aria-label="Return to the public website"
          className="admin-dashboard__brand"
          href="/"
          onClick={() => handleNavigation("/")}
        >
          <span aria-hidden="true" className="brand__mark">BS</span>
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
              const isActive = isAdminNavigationItemActive(pathname, item.href);

              return (
                <li key={item.label}>
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={[
                      "admin-dashboard__nav-item",
                      isActive ? "admin-dashboard__nav-item--active" : "",
                    ].filter(Boolean).join(" ")}
                    href={item.href}
                    onClick={() => handleNavigation(item.href)}
                  >
                    <Icon aria-hidden="true" size={17} />
                    <span>{item.label}</span>
                  </Link>
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
    </>
  );
}
