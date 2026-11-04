import "server-only";

import type { Prisma } from "@/generated/prisma/client";

export const siteProfileFieldsSelect = {
  displayName: true,
  headline: true,
  shortBio: true,
  biography: true,
  avatarUrl: true,
} satisfies Prisma.SiteProfileSelect;

export const publicSiteProfileSelect = {
  ...siteProfileFieldsSelect,
  socialLinks: {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      label: true,
      url: true,
    },
  },
} satisfies Prisma.SiteProfileSelect;

export type SiteProfileFields = Prisma.SiteProfileGetPayload<{
  select: typeof siteProfileFieldsSelect;
}>;

export type PublicSiteProfile = Prisma.SiteProfileGetPayload<{
  select: typeof publicSiteProfileSelect;
}>;

export const publicSiteProfileQuery = {
  where: { id: 1 },
  select: publicSiteProfileSelect,
} satisfies Prisma.SiteProfileFindUniqueArgs;
