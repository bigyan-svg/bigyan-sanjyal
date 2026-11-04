import type { SiteProfileFields } from "./public-site-profile-query";
import { hasUnsavedChanges } from "./unsaved-changes";

export interface ProfileValues {
  displayName: string;
  headline: string;
  shortBio: string;
  biography: string;
  avatarUrl: string;
}

function optionalValue(value: string | null): string {
  return typeof value === "string" && value.trim() ? value : "";
}

function normalizeSingleLine(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeMultiline(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
    .trim();
}

function normalizeAvatarUrl(value: string): string {
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" && url.hostname && !url.username && !url.password) {
      return url.href;
    }
  } catch {
    // Keep malformed user input distinct so it remains dirty until corrected.
  }
  return candidate;
}

export function toProfileValues(profile: SiteProfileFields): ProfileValues {
  return {
    displayName: profile.displayName,
    headline: profile.headline ?? "",
    shortBio: profile.shortBio ?? "",
    biography: profile.biography ?? "",
    avatarUrl: profile.avatarUrl ?? "",
  };
}

export function normalizeProfileValues(values: ProfileValues): ProfileValues {
  return {
    displayName: normalizeSingleLine(values.displayName),
    headline: normalizeSingleLine(optionalValue(values.headline)),
    shortBio: normalizeSingleLine(optionalValue(values.shortBio)),
    biography: normalizeMultiline(optionalValue(values.biography)),
    avatarUrl: normalizeAvatarUrl(optionalValue(values.avatarUrl)),
  };
}

export function hasProfileUnsavedChanges(
  initialValues: ProfileValues,
  currentValues: ProfileValues,
): boolean {
  return hasUnsavedChanges(
    normalizeProfileValues(initialValues),
    normalizeProfileValues(currentValues),
  );
}
