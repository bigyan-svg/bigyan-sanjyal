import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
} from "../admin-settings-password";

export type PasswordRecoveryValidationFailure = "mismatch" | "too-short" | "too-long";

export function getPasswordRecoveryValidationFailure(
  password: string,
  confirmation: string,
): PasswordRecoveryValidationFailure | null {
  if (password !== confirmation) return "mismatch";
  if (password.length > ADMIN_PASSWORD_MAX_LENGTH) return "too-long";
  if (Array.from(password).length < ADMIN_PASSWORD_MIN_LENGTH) return "too-short";
  return null;
}
