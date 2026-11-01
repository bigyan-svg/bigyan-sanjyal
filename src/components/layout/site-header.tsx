"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useDismissableLayer } from "@/hooks/use-dismissable-layer";

const navigationItems = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Skills", href: "/skills" },
  { label: "Projects", href: "/projects" },
  { label: "Education", href: "/education" },
  { label: "Experience", href: "/experience" },
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const desktopNavigationRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useDismissableLayer({
    enabled: menuOpen,
    insideRefs: [menuButtonRef, menuPanelRef],
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
    if (!menuOpen) return;

    const desktopBreakpoint = window.matchMedia("(min-width: 64rem)");
    function closeOnDesktop() {
      if (desktopBreakpoint.matches) {
        setMenuOpen(false);
        window.requestAnimationFrame(() => {
          const currentLink = desktopNavigationRef.current?.querySelector<HTMLElement>(
            'a[aria-current="page"]',
          );
          (currentLink ?? desktopNavigationRef.current?.querySelector<HTMLElement>("a"))?.focus();
        });
      }
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

  function handleDrawerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const panel = menuPanelRef.current;
    if (!panel) return;
    const focusableElements = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusableElements.item(0);
    const last = focusableElements.item(focusableElements.length - 1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
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

            <nav aria-label="Primary navigation" className="desktop-nav" ref={desktopNavigationRef}>
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
                onClick={() => menuOpen ? closeMenuAndRestoreFocus() : setMenuOpen(true)}
                ref={menuButtonRef}
                type="button"
              >
                <Menu aria-hidden="true" size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <div
      aria-hidden={!menuOpen}
      className="mobile-nav__layer"
      data-open={menuOpen}
      inert={!menuOpen}
    >
      <button
        aria-label="Close navigation menu"
        className="mobile-nav__backdrop"
        onClick={closeMenuAndRestoreFocus}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-label="Site navigation"
        aria-modal={menuOpen ? true : undefined}
        className="mobile-nav__panel"
        data-open={menuOpen}
        id="mobile-navigation"
        onKeyDown={handleDrawerKeyDown}
        ref={menuPanelRef}
        role="dialog"
      >
        <div className="mobile-nav__heading">
          <Link className="brand" href="/" onClick={closeMenuAndRestoreFocus}>
            <span aria-hidden="true" className="brand__mark">{monogram}</span>
            <span className="brand__text">
              <span className="brand__name">{displayName}</span>
              <span className="brand__caption">Personal website</span>
            </span>
          </Link>
          <button
            aria-label="Close navigation menu"
            className="mobile-nav__close"
            onClick={closeMenuAndRestoreFocus}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <nav aria-label="Mobile navigation">
          <div className="primary-nav__links">
            {navigationItems.map((item) => (
              <Link
                aria-current={pathname === item.href ? "page" : undefined}
                className="primary-nav__link"
                href={item.href}
                key={item.href}
                onClick={closeMenuAndRestoreFocus}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
    </>
  );
}
