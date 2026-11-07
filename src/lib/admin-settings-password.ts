export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MAX_LENGTH = 1_024;

export interface PasswordChangeFormValues {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

export type PasswordChangeField = keyof PasswordChangeFormValues;
export type PasswordChangeFieldErrors = Partial<Record<PasswordChangeField, string>>;

export function validatePasswordChangeForm(
  values: PasswordChangeFormValues,
): PasswordChangeFieldErrors {
  const errors: PasswordChangeFieldErrors = {};

  if (!values.currentPassword) {
    errors.currentPassword = "Enter your current password.";
  } else if (values.currentPassword.length > ADMIN_PASSWORD_MAX_LENGTH) {
    errors.currentPassword = "The current password is too long.";
  }

  if (!values.newPassword) {
    errors.newPassword = "Enter a new password.";
  } else if (values.newPassword.length > ADMIN_PASSWORD_MAX_LENGTH) {
    errors.newPassword = "The new password is too long.";
  } else if (Array.from(values.newPassword).length < ADMIN_PASSWORD_MIN_LENGTH) {
    errors.newPassword = `Use at least ${ADMIN_PASSWORD_MIN_LENGTH} characters.`;
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = "Choose a password different from your current password.";
  }

  if (!values.confirmNewPassword) {
    errors.confirmNewPassword = "Confirm your new password.";
  } else if (values.confirmNewPassword.length > ADMIN_PASSWORD_MAX_LENGTH) {
    errors.confirmNewPassword = "The confirmation is too long.";
  } else if (values.confirmNewPassword !== values.newPassword) {
    errors.confirmNewPassword = "The passwords do not match.";
  }

  return errors;
}

export function createPasswordChangePayload(
  values: PasswordChangeFormValues,
): PasswordChangeFormValues {
  return {
    currentPassword: values.currentPassword,
    newPassword: values.newPassword,
    confirmNewPassword: values.confirmNewPassword,
  };
}

export type PasswordChangeFailure =
  | "invalid-request"
  | "request-unverified"
  | "unauthorized"
  | "rate-limited"
  | "unavailable"
  | "network"
  | "unexpected";

export type PasswordChangeResult =
  | { ok: true; sessionCookieCleared: boolean }
  | { ok: false; reason: PasswordChangeFailure };

export function passwordChangeFailureMessage(reason: PasswordChangeFailure): string {
  switch (reason) {
    case "invalid-request":
      return "The request could not be processed. Check the password requirements and try again.";
    case "request-unverified":
      return "This request could not be verified. Refresh the page and try again.";
    case "unauthorized":
      return "Your session may have expired, or the current password could not be verified. If you were signed out, sign in again; otherwise check the current password and retry.";
    case "rate-limited":
      return "Too many password-change attempts. Wait a while, then try again.";
    case "unavailable":
      return "Password changes are temporarily unavailable. Please try again later.";
    case "network":
      return "We could not reach the server. Check your connection and try again.";
    default:
      return "Unable to change the password right now. Please try again.";
  }
}

function failureForStatus(status: number): PasswordChangeFailure {
  if (status === 400 || status === 413 || status === 415) return "invalid-request";
  if (status === 403) return "request-unverified";
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate-limited";
  if (status === 503) return "unavailable";
  return "unexpected";
}

export async function requestPasswordChange(
  values: PasswordChangeFormValues,
  fetcher: typeof fetch = fetch,
): Promise<PasswordChangeResult> {
  let response: Response;

  try {
    response = await fetcher("/api/auth/change-password", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPasswordChangePayload(values)),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: failureForStatus(response.status) };
  }

  const body: unknown = await response.json().catch(() => null);

  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    body.success === true &&
    "sessionCookieCleared" in body &&
    typeof body.sessionCookieCleared === "boolean"
  ) {
    return { ok: true, sessionCookieCleared: body.sessionCookieCleared };
  }

  return { ok: false, reason: "unexpected" };
}

export interface PasswordChangeSubmissionGuard {
  run<T>(operation: () => Promise<T>): Promise<{ started: true; value: T } | { started: false }>;
}

export function createPasswordChangeSubmissionGuard(): PasswordChangeSubmissionGuard {
  let pending = false;

  return {
    async run<T>(operation: () => Promise<T>) {
      if (pending) return { started: false } as const;
      pending = true;

      try {
        return { started: true, value: await operation() } as const;
      } finally {
        pending = false;
      }
    },
  };
}
