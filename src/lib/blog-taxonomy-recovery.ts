import type { BlogTaxonomyDeleteResult } from "@/lib/blog-taxonomy-client";

export type BlogTaxonomyDeleteRecoveryResult =
  | { outcome: "rejected"; error: string }
  | { outcome: "refresh-failed"; deletionConfirmed: boolean }
  | { outcome: "refreshed-uncertain" }
  | { outcome: "deleted"; count: number };

/**
 * Resolve a taxonomy deletion response while treating transport and server
 * failures as ambiguous. The authoritative refresh runs before this function
 * returns so the caller can keep its shared mutation lock through reconciliation.
 */
export async function recoverBlogTaxonomyDelete(
  request: () => Promise<BlogTaxonomyDeleteResult>,
  refresh: (deletionConfirmed: boolean) => Promise<boolean>,
): Promise<BlogTaxonomyDeleteRecoveryResult> {
  let deletion: BlogTaxonomyDeleteResult;
  try {
    deletion = await request();
  } catch {
    deletion = {
      ok: false,
      error: "Unable to confirm the deletion response.",
      mutationMayHaveSucceeded: true,
    };
  }

  if (!deletion.ok && !deletion.mutationMayHaveSucceeded) {
    return { outcome: "rejected", error: deletion.error };
  }

  const deletionConfirmed = deletion.ok;
  let refreshed = false;
  try {
    refreshed = await refresh(deletionConfirmed);
  } catch {
    // The caller must preserve its current snapshot and keep mutations blocked.
  }

  if (!refreshed) return { outcome: "refresh-failed", deletionConfirmed };
  if (!deletion.ok) return { outcome: "refreshed-uncertain" };
  return { outcome: "deleted", count: deletion.count };
}
