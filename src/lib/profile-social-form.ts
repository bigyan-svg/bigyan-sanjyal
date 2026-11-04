import { hasUnsavedChanges } from "./unsaved-changes";
import {
  normalizeSafeSocialUrl,
  normalizeSocialLinkLabel,
  type AdminSocialLink,
} from "./profile-social-validation";

export interface SocialLinkFormValues {
  label: string;
  url: string;
}

export function createEmptySocialLinkFormValues(): SocialLinkFormValues {
  return { label: "", url: "" };
}

export function socialLinkToFormValues(link: AdminSocialLink): SocialLinkFormValues {
  return { label: link.label, url: link.url };
}

function normalized(values: SocialLinkFormValues): SocialLinkFormValues {
  return {
    label: normalizeSocialLinkLabel(values.label) ?? values.label.trim(),
    url: normalizeSafeSocialUrl(values.url) ?? values.url.trim(),
  };
}

export function hasSocialLinkUnsavedChanges(
  initialValues: SocialLinkFormValues,
  currentValues: SocialLinkFormValues,
): boolean {
  return hasUnsavedChanges(normalized(initialValues), normalized(currentValues));
}
