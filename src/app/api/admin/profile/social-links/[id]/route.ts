import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import {
  authorizeAdminContentWrite,
} from "@/lib/auth/admin-content";
import {
  handleSocialLinkDelete,
  handleSocialLinkUpdate,
} from "@/lib/profile-social-management";
import {
  reorderProfileSocialLinksInTransaction,
  SocialLinkWriteConflictError,
} from "@/lib/profile-social-content";
import { parseCreateSocialLink, type AdminSocialLink } from "@/lib/profile-social-validation";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return handleSocialLinkUpdate(request, id, {
    authorize: authorizeAdminContentWrite,
    update: async (socialLinkId, patch) => prisma.$transaction(async (transaction) => {
      const existing = await transaction.socialLink.findFirst({
        where: { id: socialLinkId, profileId: SITE_PROFILE_ID },
        select: { label: true, url: true },
      });
      if (!existing) return { kind: "missing" as const };

      const parsed = parseCreateSocialLink({
        label: patch.label ?? existing.label,
        url: patch.url ?? existing.url,
      });
      if (!parsed.data) return { kind: "invalid" as const, errors: parsed.errors };

      const updateData = {
        ...(patch.label !== undefined ? { label: parsed.data.label } : {}),
        ...(patch.url !== undefined ? { url: parsed.data.url } : {}),
      };

      const updated = await transaction.socialLink.updateMany({
        where: { id: socialLinkId, profileId: SITE_PROFILE_ID },
        data: updateData,
      });
      if (updated.count !== 1) return { kind: "missing" as const };

      const link = await transaction.socialLink.findFirst({
        where: { id: socialLinkId, profileId: SITE_PROFILE_ID },
        select: socialLinkSelect,
      });
      return link
        ? { kind: "updated" as const, link: link as AdminSocialLink }
        : { kind: "missing" as const };
    }),
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return handleSocialLinkDelete(request, id, {
    authorize: (incomingRequest) => authorizeAdminContentWrite(incomingRequest, false),
    delete: async (socialLinkId) => {
      try {
        return await prisma.$transaction(async (transaction) => {
          const removed = await transaction.socialLink.deleteMany({
            where: { id: socialLinkId, profileId: SITE_PROFILE_ID },
          });
          if (removed.count !== 1) return false;

          const remaining = await transaction.socialLink.findMany({
            where: { profileId: SITE_PROFILE_ID },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: { id: true },
          });

          await reorderProfileSocialLinksInTransaction({
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
          }, remaining.map((link) => link.id));

          return true;
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
