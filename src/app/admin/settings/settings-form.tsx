"use client";

import { CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/form-field";
import { useAdminUnsavedNavigationProtection } from "@/components/admin/admin-unsaved-navigation-guard";
import {
  createPasswordChangeSubmissionGuard,
  passwordChangeFailureMessage,
  requestPasswordChange,
  validatePasswordChangeForm,
  type PasswordChangeFailure,
  type PasswordChangeField,
  type PasswordChangeFieldErrors,
  type PasswordChangeFormValues,
} from "@/lib/admin-settings-password";

const EMPTY_VALUES: PasswordChangeFormValues = {
  currentPassword: "",
  newPassword: "",
  confirmNewPassword: "",
};

const FIELD_CONFIG: {
  field: PasswordChangeField;
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}[] = [
  {
    field: "currentPassword",
    id: "settings-current-password",
    label: "Current password",
    autoComplete: "current-password",
  },
  {
    field: "newPassword",
    id: "settings-new-password",
    label: "New password",
    autoComplete: "new-password",
    hint: "Use at least 12 characters. Passwords may contain up to 1,024 characters.",
  },
  {
    field: "confirmNewPassword",
    id: "settings-confirm-password",
    label: "Confirm new password",
    autoComplete: "new-password",
  },
];

export function SettingsForm() {
  const [values, setValues] = useState(EMPTY_VALUES);
  const [visibleFields, setVisibleFields] = useState<Partial<Record<PasswordChangeField, boolean>>>({});
  const [fieldErrors, setFieldErrors] = useState<PasswordChangeFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [failureReason, setFailureReason] = useState<PasswordChangeFailure | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const submissionGuard = useRef(createPasswordChangeSubmissionGuard());
  useAdminUnsavedNavigationProtection(Object.values(values).some((value) => value.length > 0));

  function updateField(field: PasswordChangeField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setErrorMessage("");
    setFailureReason(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setFailureReason(null);

    const errors = validatePasswordChangeForm(values);
    setFieldErrors(errors);

    if (Object.keys(errors).length > 0) return;

    await submissionGuard.current.run(async () => {
      setIsSubmitting(true);

      try {
        const result = await requestPasswordChange(values);

        if (result.ok) {
          setValues(EMPTY_VALUES);
          setVisibleFields({});
          setFieldErrors({});
          setFailureReason(null);
          setIsComplete(true);
          return;
        }

        setFailureReason(result.reason);
        setErrorMessage(passwordChangeFailureMessage(result.reason));
      } finally {
        setIsSubmitting(false);
      }
    });

  }

  if (isComplete) {
    return (
      <div aria-live="polite" className="admin-settings__complete" role="status">
        <CheckCircle2 aria-hidden="true" size={22} />
        <div>
          <h3>Password changed</h3>
          <p>
            Your password was updated and all active admin sessions were revoked. Sign in
            again using your new password.
          </p>
          <Link className="button button--primary button--medium" href="/admin/login">
            Continue to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      aria-busy={isSubmitting}
      className="admin-settings__form"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="admin-settings__fields">
        {FIELD_CONFIG.map(({ field, id, label, autoComplete, hint }) => {
          const isVisible = Boolean(visibleFields[field]);
          const ToggleIcon = isVisible ? EyeOff : Eye;

          return (
            <div className="admin-settings__password-field" key={field}>
              <TextInput
                autoComplete={autoComplete}
                disabled={isSubmitting}
                error={fieldErrors[field]}
                hint={hint}
                id={id}
                label={label}
                maxLength={1_024}
                name={field}
                onChange={(event) => updateField(field, event.target.value)}
                required
                type={isVisible ? "text" : "password"}
                value={values[field]}
              />
              <button
                aria-controls={id}
                aria-label={`${isVisible ? "Hide" : "Show"} ${label.toLowerCase()}`}
                className="admin-settings__visibility-toggle"
                disabled={isSubmitting}
                onClick={() =>
                  setVisibleFields((current) => ({ ...current, [field]: !current[field] }))
                }
                type="button"
              >
                <ToggleIcon aria-hidden="true" size={17} />
              </button>
            </div>
          );
        })}
      </div>

      <div aria-live="assertive" className="admin-settings__feedback">
        {errorMessage ? (
          <div role="alert">
            <p>{errorMessage}</p>
            {failureReason === "unauthorized" ? (
              <Link className="admin-settings__signin-link" href="/admin/login">
                Go to sign in
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="admin-settings__actions">
        <p>
          <LockKeyhole aria-hidden="true" size={15} />
          Passwords are kept only while this page is open and are not saved to browser storage.
        </p>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? (
            <LoaderCircle aria-hidden="true" className="admin-settings__spinner" size={17} />
          ) : (
            <LockKeyhole aria-hidden="true" size={17} />
          )}
          {isSubmitting ? "Changing password…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
