"use client";

import { CheckCircle2, LoaderCircle, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import type { PublicSiteProfile } from "@/lib/site-profile";

type ProfileValues = {
  displayName: string;
  headline: string;
  shortBio: string;
  biography: string;
  avatarUrl: string;
};

type ProfileField = keyof ProfileValues;
type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

function toProfileValues(profile: PublicSiteProfile): ProfileValues {
  return {
    displayName: profile.displayName,
    headline: profile.headline ?? "",
    shortBio: profile.shortBio ?? "",
    biography: profile.biography ?? "",
    avatarUrl: profile.avatarUrl ?? "",
  };
}

export function ProfileForm({ initialProfile }: { initialProfile: PublicSiteProfile }) {
  const [values, setValues] = useState(() => toProfileValues(initialProfile));
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  function updateField(field: ProfileField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setSuccessMessage("");
    setErrorMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    setIsSaving(true);
    setFieldErrors({});
    setSuccessMessage("");
    setErrorMessage("");

    try {
      const response = await fetch("/api/admin/profile", {
        method: "PUT",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (
          response.status === 422 &&
          typeof result === "object" &&
          result !== null &&
          "fields" in result &&
          typeof result.fields === "object" &&
          result.fields !== null
        ) {
          setFieldErrors(result.fields as ProfileFieldErrors);
        }

        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Unable to save the profile. Please try again.";
        setErrorMessage(message);
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("profile" in result) ||
        typeof result.profile !== "object" ||
        result.profile === null
      ) {
        setErrorMessage("The profile was saved, but the updated values could not be loaded.");
        return;
      }

      setValues(toProfileValues(result.profile as PublicSiteProfile));
      setSuccessMessage("Profile changes saved. Public pages now show the updated information.");
    } catch {
      setErrorMessage("Unable to save the profile. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="profile-management__card" variant="outlined">
      <div className="profile-management__intro">
        <div>
          <p className="eyebrow">Public profile</p>
          <h2>Profile details</h2>
        </div>
        <p>Only these profile fields are shared with visitors.</p>
      </div>

      <form
        aria-busy={isSaving}
        className="profile-management__form"
        onSubmit={handleSubmit}
      >
        <TextInput
          autoComplete="name"
          error={fieldErrors.displayName}
          id="profile-display-name"
          label="Display name"
          maxLength={120}
          name="displayName"
          onChange={(event) => updateField("displayName", event.target.value)}
          required
          value={values.displayName}
        />

        <TextInput
          error={fieldErrors.headline}
          hint="Optional. Up to 160 characters."
          id="profile-headline"
          label="Professional headline"
          maxLength={160}
          name="headline"
          onChange={(event) => updateField("headline", event.target.value)}
          value={values.headline}
        />

        <TextArea
          error={fieldErrors.shortBio}
          hint="Optional short introduction. Up to 300 characters."
          id="profile-short-bio"
          label="Short biography"
          maxLength={300}
          name="shortBio"
          onChange={(event) => updateField("shortBio", event.target.value)}
          rows={3}
          value={values.shortBio}
        />

        <TextArea
          error={fieldErrors.biography}
          hint="Optional longer biography. Plain text only, up to 10,000 characters."
          id="profile-biography"
          label="Full biography"
          maxLength={10_000}
          name="biography"
          onChange={(event) => updateField("biography", event.target.value)}
          rows={9}
          value={values.biography}
        />

        <TextInput
          autoComplete="url"
          error={fieldErrors.avatarUrl}
          hint="Optional. Use an HTTPS image URL."
          id="profile-avatar-url"
          label="Avatar URL"
          maxLength={2_048}
          name="avatarUrl"
          onChange={(event) => updateField("avatarUrl", event.target.value)}
          placeholder="https://example.com/image.jpg"
          type="url"
          value={values.avatarUrl}
        />

        <div aria-live="polite" className="profile-management__feedback">
          {successMessage ? (
            <p className="profile-management__success" role="status">
              <CheckCircle2 aria-hidden="true" size={17} />
              {successMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="profile-management__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="profile-management__actions">
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="profile-management__spinner" size={17} />
            ) : (
              <Save aria-hidden="true" size={17} />
            )}
            {isSaving ? "Saving changes…" : "Save profile"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
