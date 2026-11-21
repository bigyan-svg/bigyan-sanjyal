export interface PreviewAdminTarget {
  confirmation: string;
  display: string;
}

export class PreviewAdminTargetError extends Error {}

export const PREVIEW_ADMIN_HOST =
  "ep-patient-frost-b34hmovu.c-4.ap-southeast-1.aws.neon.tech";
export const PREVIEW_ADMIN_POOLER_HOST =
  "ep-patient-frost-b34hmovu-pooler.c-4.ap-southeast-1.aws.neon.tech";
export const PREVIEW_ADMIN_DATABASE = "neondb";

export function getPreviewAdminTarget(
  databaseUrl: string | undefined,
): PreviewAdminTarget | null {
  if (!databaseUrl || databaseUrl !== databaseUrl.trim()) return null;

  try {
    const parsed = new URL(databaseUrl);
    if (
      (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
      (parsed.hostname !== PREVIEW_ADMIN_HOST &&
        parsed.hostname !== PREVIEW_ADMIN_POOLER_HOST) ||
      (parsed.port !== "" && parsed.port !== "5432") ||
      parsed.hash !== ""
    ) {
      return null;
    }

    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (database !== PREVIEW_ADMIN_DATABASE) return null;
    if (!parsed.username || !parsed.password) return null;
    if (
      [...parsed.searchParams.keys()].some((key) =>
        ["database", "host", "port", "password", "user"].includes(
          key.toLowerCase(),
        ),
      )
    ) {
      return null;
    }

    const display = `${parsed.hostname}:${parsed.port || "5432"}/${PREVIEW_ADMIN_DATABASE}`;
    return {
      confirmation: `PROVISION PREVIEW ADMIN ${display}`,
      display,
    };
  } catch {
    return null;
  }
}

export function assertPreviewAdminConfirmation(
  enteredConfirmation: string,
  target: PreviewAdminTarget,
): void {
  if (enteredConfirmation !== target.confirmation) {
    throw new PreviewAdminTargetError(
      "Preview target confirmation did not match.",
    );
  }
}

export function getPreviewEditorConfirmation(target: PreviewAdminTarget): string {
  return `PROVISION PREVIEW EDITOR ${target.display}`;
}

export function assertPreviewEditorConfirmation(
  enteredConfirmation: string,
  target: PreviewAdminTarget,
): void {
  if (enteredConfirmation !== getPreviewEditorConfirmation(target)) {
    throw new PreviewAdminTargetError(
      "Preview Editor target confirmation did not match.",
    );
  }
}
