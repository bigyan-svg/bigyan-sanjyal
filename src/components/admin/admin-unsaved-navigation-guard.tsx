"use client";

import { useId, useLayoutEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  confirmAdminNavigationIfDirty,
  hasPendingAdminOperations,
  hasProtectedAdminForms,
  setAdminFormProtection,
} from "@/lib/admin-navigation-guard";
import {
  recordAdminHistoryPush,
  resolveAdminHistoryTraversal,
  type AdminHistoryLedger,
} from "@/lib/admin-navigation-guard";

const HISTORY_ENTRY_KEY = "__bigyanAdminHistoryEntry";

let historyLedger: AdminHistoryLedger | null = null;
let pendingHistoryTraversal = false;
let approvedNavigationTraversal = false;

interface NavigationDestinationLike {
  url: string;
  sameDocument: boolean;
}

interface NavigationEventLike extends Event {
  navigationType: string;
  canIntercept: boolean;
  destination: NavigationDestinationLike;
}

interface NavigationLike {
  addEventListener(
    type: "navigate",
    listener: (event: NavigationEventLike) => void,
  ): void;
  removeEventListener(
    type: "navigate",
    listener: (event: NavigationEventLike) => void,
  ): void;
}

function createHistoryId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function historyEntryId(state: unknown): string | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const value = (state as Record<string, unknown>)[HISTORY_ENTRY_KEY];
  return typeof value === "string" ? value : null;
}

function writeHistoryEntryId(id: string): void {
  const currentState = window.history.state;
  const nextState = typeof currentState === "object" && currentState !== null && !Array.isArray(currentState)
    ? { ...(currentState as Record<string, unknown>), [HISTORY_ENTRY_KEY]: id }
    : { [HISTORY_ENTRY_KEY]: id };
  window.history.replaceState(nextState, "", window.location.href);
}

function currentRouteKey(pathname: string, search: string): string {
  return `${pathname}${search ? `?${search}` : ""}`;
}

function routeKeyFromLocation(location: Location): string {
  return currentRouteKey(location.pathname, location.search.slice(1));
}

export function useAdminUnsavedNavigationProtection(isDirty: boolean, isPending = false): void {
  const id = useId();
  useLayoutEffect(() => {
    setAdminFormProtection(id, isDirty, isPending);
    return () => setAdminFormProtection(id, false);
  }, [id, isDirty, isPending]);
}

export function AdminUnsavedNavigationGuard() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams.toString();

  useLayoutEffect(() => {
    if (!pathname) return;
    const route = currentRouteKey(pathname, search);

    if (!historyLedger) {
      const id = historyEntryId(window.history.state) ?? createHistoryId();
      writeHistoryEntryId(id);
      historyLedger = { entries: [{ id, href: route }], index: 0 };
      return;
    }

    if (pendingHistoryTraversal) {
      pendingHistoryTraversal = false;
      const entry = historyLedger.entries[historyLedger.index];
      if (entry) {
        entry.href = route;
        writeHistoryEntryId(entry.id);
      }
      return;
    }

    const current = historyLedger.entries[historyLedger.index];
    if (current?.href === route) return;

    const id = createHistoryId();
    historyLedger = recordAdminHistoryPush(historyLedger, route, id);
    writeHistoryEntryId(id);
  }, [pathname, search]);

  useLayoutEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasProtectedAdminForms()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function handleLinkNavigation(event: MouseEvent) {
      if (
        !hasProtectedAdminForms() || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      ) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) return;

      let destination: URL;
      try {
        destination = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;
      if (currentRouteKey(destination.pathname, destination.search.slice(1)) === routeKeyFromLocation(window.location)) {
        return;
      }

      if (!confirmAdminNavigationIfDirty()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    function handleHistoryNavigation(event: PopStateEvent) {
      const ledger = historyLedger;
      if (!ledger) return;

      if (approvedNavigationTraversal) {
        approvedNavigationTraversal = false;
        const targetId = historyEntryId(event.state);
        const targetIndex = targetId
          ? ledger.entries.findIndex((entry) => entry.id === targetId)
          : -1;
        if (targetIndex >= 0) {
          const previousRoute = ledger.entries[ledger.index]?.href;
          const targetRoute = ledger.entries[targetIndex]?.href;
          ledger.index = targetIndex;
          pendingHistoryTraversal = previousRoute !== targetRoute;
        } else {
          resetHistoryLedgerFromCurrentLocation(event.state);
        }
        return;
      }

      const decision = resolveAdminHistoryTraversal(
        ledger,
        historyEntryId(event.state),
        hasProtectedAdminForms(),
        () => confirmAdminNavigationIfDirty(),
      );

      if (decision.kind === "allow") {
        const previousRoute = ledger.entries[ledger.index]?.href;
        const targetRoute = ledger.entries[decision.index]?.href;
        ledger.index = decision.index;
        pendingHistoryTraversal = previousRoute !== targetRoute;
        return;
      }

      if (decision.kind === "restore") {
        // popstate is delivered after the browser moved the history pointer.
        // Suppress App Router's later listener and return to the exact entry
        // using its known index; no new history entry is created.
        event.stopImmediatePropagation();
        window.history.go(decision.delta);
        return;
      }

      if (hasProtectedAdminForms() && !confirmAdminNavigationIfDirty()) {
        // The browser has already moved to this entry. For an untracked entry
        // we cannot determine Back versus Forward from popstate alone, so do
        // not guess a history.go() direction. Replace the target entry with
        // the guarded route to keep the URL and rendered page aligned without
        // adding a history entry or discarding the form state.
        event.stopImmediatePropagation();
        const guardedEntry = ledger.entries[ledger.index];
        if (guardedEntry) {
          const id = createHistoryId();
          historyLedger = { entries: [{ id, href: guardedEntry.href }], index: 0 };
          pendingHistoryTraversal = false;
          if (hasPendingAdminOperations()) {
            const currentState = window.history.state;
            const nextState = typeof currentState === "object" && currentState !== null && !Array.isArray(currentState)
              ? { ...(currentState as Record<string, unknown>), [HISTORY_ENTRY_KEY]: id }
              : { [HISTORY_ENTRY_KEY]: id };
            window.history.replaceState(nextState, "", guardedEntry.href);
          } else {
            writeHistoryEntryId(id);
            router.replace(guardedEntry.href);
          }
        }
        return;
      }

      resetHistoryLedgerFromCurrentLocation(event.state);
    }

    function resetHistoryLedgerFromCurrentLocation(state: unknown) {
      const id = historyEntryId(state) ?? createHistoryId();
      const href = routeKeyFromLocation(window.location);
      historyLedger = { entries: [{ id, href }], index: 0 };
      writeHistoryEntryId(id);
    }

    function handleNavigate(event: NavigationEventLike) {
      if (!event.canIntercept || !event.destination.sameDocument) return;

      // A pending write cannot be overridden by confirming an unsaved-change prompt.
      // This also catches programmatic same-document App Router navigation.
      if (hasPendingAdminOperations()) {
        event.preventDefault();
        return;
      }
      if (!hasProtectedAdminForms() || event.navigationType !== "traverse") return;

      let destination: URL;
      try {
        destination = new URL(event.destination.url, window.location.href);
      } catch {
        return;
      }
      if (destination.origin !== window.location.origin) return;
      if (!confirmAdminNavigationIfDirty()) {
        event.preventDefault();
        return;
      }
      approvedNavigationTraversal = true;
    }

    document.addEventListener("click", handleLinkNavigation, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handleHistoryNavigation, true);
    const navigation = (window as Window & { navigation?: NavigationLike }).navigation;
    navigation?.addEventListener("navigate", handleNavigate);
    return () => {
      document.removeEventListener("click", handleLinkNavigation, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handleHistoryNavigation, true);
      navigation?.removeEventListener("navigate", handleNavigate);
    };
  }, [router]);

  return null;
}
