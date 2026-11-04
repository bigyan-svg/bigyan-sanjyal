import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { publicSiteProfileQuery } from "@/lib/public-site-profile-query";
import { filterSafePublicSocialLinks } from "@/lib/profile-social-validation";

export { publicSiteProfileSelect, siteProfileFieldsSelect } from "@/lib/public-site-profile-query";
export type { PublicSiteProfile, SiteProfileFields } from "@/lib/public-site-profile-query";

export const getPublicSiteProfile = cache(async () => {
  const profile = await prisma.siteProfile.findUnique(publicSiteProfileQuery);
  return profile
    ? { ...profile, socialLinks: filterSafePublicSocialLinks(profile.socialLinks) }
    : null;
});

export function getProfileInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    return "P";
  }

  const first = Array.from(words[0])[0] ?? "P";
  const last = words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : "";

  return `${first}${last}`.toLocaleUpperCase();
}
