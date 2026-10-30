import { Suspense } from "react";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getProfileInitials, getPublicSiteProfile } from "@/lib/site-profile";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Suspense fallback={<SiteHeader displayName="Personal website" monogram="P" />}>
        <SiteHeaderFromProfile />
      </Suspense>
      <main className="site-main" id="main-content">
        {children}
      </main>
      <Suspense
        fallback={<SiteFooter displayName="Personal website" headline={null} monogram="P" />}
      >
        <SiteFooterFromProfile />
      </Suspense>
    </>
  );
}

async function SiteHeaderFromProfile() {
  let displayName = "Personal website";

  try {
    const profile = await getPublicSiteProfile();
    displayName = profile?.displayName ?? "Personal website";
  } catch {
    displayName = "Personal website";
  }

  return <SiteHeader displayName={displayName} monogram={getProfileInitials(displayName)} />;
}

async function SiteFooterFromProfile() {
  let displayName = "Personal website";
  let headline: string | null = null;

  try {
    const profile = await getPublicSiteProfile();
    displayName = profile?.displayName ?? "Personal website";
    headline = profile?.headline ?? null;
  } catch {
    displayName = "Personal website";
    headline = null;
  }

  return (
    <SiteFooter
      displayName={displayName}
      headline={headline}
      monogram={getProfileInitials(displayName)}
    />
  );
}
