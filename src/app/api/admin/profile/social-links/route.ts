import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  authorizeAdminContentRead,
  authorizeAdminContentWrite,
} from "@/lib/auth/admin-content";
import {
  reorderProfileSocialLinksInTransaction,
  SocialLinkOrderConflictError,
  SocialLinkWriteConflictError,
} from "@/lib/profile-social-content";
import {
  handleSocialLinkCreate,
  handleSocialLinkList,
  handleSocialLinkReorder,
} from "@/lib/profile-social-management";
import {
  resolveNextSocialLinkSortOrder,
  type AdminSocialLink,
  SOCIAL_LINK_MAX_COUNT,
} from "@/lib/profile-social-validation";
import { prisma } from "@/lib/prisma";

const SITE_PROFILE_ID = 1;

const socialLinkSelect = {
  id: true,
  label: true,
  url: true,
  sortOrder: true,
} satisfies Prisma.SocialLinkSelect;

function getPrismaErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  return handleSocialLinkList(request, {
    authorize: authorizeAdminContentRead,
    findAll: () => prisma.socialLink.findMany({
      where: { profileId: SITE_PROFILE_ID },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: socialLinkSelect,
    }) as Promise<AdminSocialLink[]>,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleSocialLinkCreate(request, {
    authorize: authorizeAdminContentWrite,
    create: async (data) => {
      try {
        return await prisma.$transaction(async (transaction) => {
          const linkCount = await transaction.socialLink.count({
            where: { profileId: SITE_PROFILE_ID },
          });
          if (linkCount >= SOCIAL_LINK_MAX_COUNT) return null;

          const highestOrder = await transaction.socialLink.findFirst({
            where: { profileId: SITE_PROFILE_ID },
            orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
            select: { sortOrder: true },
          });
          const sortOrder = resolveNextSocialLinkSortOrder(highestOrder?.sortOrder ?? null);
          if (sortOrder === null) return null;

          return transaction.socialLink.create({
            data: { ...data, profileId: SITE_PROFILE_ID, sortOrder },
            select: socialLinkSelect,
          }) as Promise<AdminSocialLink>;
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (getPrismaErrorCode(error) === "P2034") {
          throw new SocialLinkWriteConflictError();
        }
        throw error;
      }
    },
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleSocialLinkReorder(request, {
    authorize: authorizeAdminContentWrite,
    reorder: async (orderedIds) => {
      try {
        return await prisma.$transaction(async (transaction) =>
          reorderProfileSocialLinksInTransaction({
            findLinkIds: async (profileId) => {
              const links = await transaction.socialLink.findMany({
                where: { profileId },
                select: { id: true },
              });
              return links.map((link) => link.id);
            },
            setLinkSortOrder: async (profileId, id, sortOrder) => {
              const result = await transaction.socialLink.updateMany({
                where: { id, profileId },
                data: { sortOrder },
              });
              return result.count;
            },
          }, orderedIds),
        { isolationLevel: "Serializable" });
      } catch (error) {
        if (getPrismaErrorCode(error) === "P2034") {
          throw new SocialLinkOrderConflictError();
        }
        throw error;
      }
    },
  });
}

