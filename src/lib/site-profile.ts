import "server-only";

import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const publicSiteProfileSelect = {
  displayName: true,
  headline: true,
  shortBio: true,
  biography: true,
  avatarUrl: true,
} satisfies Prisma.SiteProfileSelect;

export type PublicSiteProfile = Prisma.SiteProfileGetPayload<{
  select: typeof publicSiteProfileSelect;
}>;

export const getPublicSiteProfile = cache(async () =>
  prisma.siteProfile.findUnique({
    where: { id: 1 },
    select: publicSiteProfileSelect,
  }),
);

export function getProfileInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    return "P";
  }

  const first = Array.from(words[0])[0] ?? "P";
  const last = words.length > 1 ? Array.from(words.at(-1) ?? "")[0] : "";

  return `${first}${last}`.toLocaleUpperCase();
}
