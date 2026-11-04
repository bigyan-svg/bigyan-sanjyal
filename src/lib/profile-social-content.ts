import "server-only";

import { SOCIAL_LINK_SORT_ORDER_MAX } from "./profile-social-validation";

export class SocialLinkWriteConflictError extends Error {}
export class SocialLinkOrderConflictError extends SocialLinkWriteConflictError {}

export interface ProfileSocialOrderTransaction {
  findLinkIds(profileId: number): Promise<string[]>;
  setLinkSortOrder(profileId: number, id: string, sortOrder: number): Promise<number>;
}

export async function reorderProfileSocialLinksInTransaction(
  transaction: ProfileSocialOrderTransaction,
  orderedIds: readonly string[],
): Promise<boolean> {
  if (orderedIds.length > SOCIAL_LINK_SORT_ORDER_MAX + 1) return false;

  const currentIds = await transaction.findLinkIds(1);
  if (
    currentIds.length !== orderedIds.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    currentIds.some((id) => !orderedIds.includes(id))
  ) {
    return false;
  }

  for (const [sortOrder, id] of orderedIds.entries()) {
    const updated = await transaction.setLinkSortOrder(1, id, sortOrder);
    if (updated !== 1) {
      throw new SocialLinkOrderConflictError();
    }
  }

  return true;
}
