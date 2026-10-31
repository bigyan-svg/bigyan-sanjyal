"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDismissableLayer } from "@/hooks/use-dismissable-layer";

const navigationItems = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Skills", href: "/skills" },
  { label: "Projects", href: "/projects" },
  { label: "Education", href: "/education" },
  { label: "Blog", href: "/blog" },
  { label: "Contact", href: "/contact" },
];

export function SiteHeader({
  displayName,
  monogram,
}: {
  displayName: string;
  monogram: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useDismissableLayer({
    enabled: menuOpen,
    insideRefs: [menuButtonRef, menuPanelRef],
    onOutsideClick: closeMenu,
    onEscape: closeMenuAndRestoreFocus,
  });

  useEffect(() => {
    if (!menuOpen) return;

    const desktopBreakpoint = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() {
      if (desktopBreakpoint.matches) setMenuOpen(false);
    }

    desktopBreakpoint.addEventListener("change", closeOnDesktop);

    return () => {
      desktopBreakpoint.removeEventListener("change", closeOnDesktop);
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  function closeMenuAndRestoreFocus() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <header className="site-header">
      <div className="container">
        <div className="site-header__frame">
          <div className="site-header__bar">
            <Link className="brand" href="/" onClick={closeMenu}>
              <span aria-hidden="true" className="brand__mark">
                {monogram}
              </span>
              <span className="brand__text">
                <span className="brand__name">{displayName}</span>
                <span className="brand__caption">Personal website</span>
              </span>
            </Link>

            <nav aria-label="Primary navigation" className="desktop-nav">
              <div className="primary-nav__links">
                {navigationItems.map((item) => (
                  <Link
                    aria-current={pathname === item.href ? "page" : undefined}
                    className="primary-nav__link"
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </nav>

            <div className="mobile-nav">
              <button
                aria-controls="mobile-navigation"
                aria-expanded={menuOpen}
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                className="menu-toggle"
                onClick={() => setMenuOpen((isOpen) => !isOpen)}
                ref={menuButtonRef}
                type="button"
              >
                {menuOpen ? (
                  <X aria-hidden="true" size={20} />
                ) : (
                  <Menu aria-hidden="true" size={20} />
                )}
              </button>
              <nav
                aria-hidden={!menuOpen}
                aria-label="Mobile navigation"
                className="mobile-nav__panel"
                data-open={menuOpen}
                id="mobile-navigation"
                inert={!menuOpen}
                ref={menuPanelRef}
              >
                <div className="primary-nav__links">
                  {navigationItems.map((item) => (
                    <Link
                      aria-current={pathname === item.href ? "page" : undefined}
                      className="primary-nav__link"
                      href={item.href}
                      key={item.href}
                      onClick={closeMenu}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
