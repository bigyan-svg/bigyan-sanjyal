export const SOCIAL_LINK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const SOCIAL_LINK_LABEL_MAX_LENGTH = 60;
export const SOCIAL_LINK_URL_MAX_LENGTH = 2_048;
export const SOCIAL_LINK_MAX_COUNT = 100;
export const SOCIAL_LINK_SORT_ORDER_MAX = 999_999;

export interface PublicSocialLink {
  label: string;
  url: string;
}

export interface AdminSocialLink extends PublicSocialLink {
  id: string;
  sortOrder: number;
}

export type SocialLinkField = "label" | "url";
export type SocialLinkFieldErrors = Partial<Record<SocialLinkField, string>>;

export type SocialLinkInput = PublicSocialLink;
export type SocialLinkPatch = Partial<SocialLinkInput>;

export type ParsedSocialLink<T> = {
  data: T | null;
  errors: SocialLinkFieldErrors;
  invalidShape?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeSocialLinkLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeSafeSocialUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();

  if (candidate.length === 0 || candidate.length > SOCIAL_LINK_URL_MAX_LENGTH) {
    return undefined;
  }

  try {
    const url = new URL(candidate);

    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return undefined;
    }

    const normalized = url.href;
    return normalized.length <= SOCIAL_LINK_URL_MAX_LENGTH ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function parseSocialLinkFields(
  values: Record<string, unknown>,
  fields: readonly SocialLinkField[],
): { data: Partial<SocialLinkInput> | null; errors: SocialLinkFieldErrors } {
  const data: Partial<SocialLinkInput> = {};
  const errors: SocialLinkFieldErrors = {};

  for (const field of fields) {
    if (field === "label") {
      const label = normalizeSocialLinkLabel(values.label);
      if (!label) {
        errors.label = "Enter a label.";
      } else if (Array.from(label).length > SOCIAL_LINK_LABEL_MAX_LENGTH) {
        errors.label = `Use ${SOCIAL_LINK_LABEL_MAX_LENGTH} characters or fewer.`;
      } else {
        data.label = label;
      }
      continue;
    }

    const url = normalizeSafeSocialUrl(values.url);
    if (!url) {
      errors.url = "Enter a valid HTTPS URL without embedded credentials.";
    } else {
      data.url = url;
    }
  }

  return Object.keys(errors).length > 0 ? { data: null, errors } : { data, errors };
}

export function parseCreateSocialLink(body: unknown): ParsedSocialLink<SocialLinkInput> {
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "label" && key !== "url")) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const parsed = parseSocialLinkFields(body, ["label", "url"]);
  return {
    data: parsed.data as SocialLinkInput | null,
    errors: parsed.errors,
  };
}

export function parseSocialLinkPatch(body: unknown): ParsedSocialLink<SocialLinkPatch> {
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "label" && key !== "url")) {
    return { data: null, errors: {}, invalidShape: true };
  }

  const fields = (["label", "url"] as const).filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (fields.length === 0) return { data: null, errors: {}, invalidShape: true };

  const parsed = parseSocialLinkFields(body, fields);
  return { data: parsed.data, errors: parsed.errors };
}

export function parseSocialLinkReorder(body: unknown): string[] | null {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "orderedIds") ||
    !Array.isArray(body.orderedIds) ||
    body.orderedIds.length > SOCIAL_LINK_MAX_COUNT
  ) {
    return null;
  }

  const ids = body.orderedIds;
  if (
    ids.some((id) => typeof id !== "string" || !SOCIAL_LINK_ID_PATTERN.test(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return null;
  }

  return ids as string[];
}

export function isValidSocialLinkId(id: string): boolean {
  return SOCIAL_LINK_ID_PATTERN.test(id);
}

export function resolveNextSocialLinkSortOrder(highestOrder: number | null): number | null {
  if (highestOrder !== null && !Number.isInteger(highestOrder)) return null;
  if (highestOrder !== null && highestOrder > SOCIAL_LINK_SORT_ORDER_MAX) return null;

  const next = Math.max(0, (highestOrder ?? -1) + 1);
  return next <= SOCIAL_LINK_SORT_ORDER_MAX ? next : null;
}

export function filterSafePublicSocialLinks(
  links: readonly PublicSocialLink[],
): PublicSocialLink[] {
  const safeLinks: PublicSocialLink[] = [];

  for (const link of links) {
    const label = normalizeSocialLinkLabel(link.label);
    const url = normalizeSafeSocialUrl(link.url);
    if (!label || Array.from(label).length > SOCIAL_LINK_LABEL_MAX_LENGTH || !url) continue;
    safeLinks.push({ label, url });
  }

  return safeLinks;
}
