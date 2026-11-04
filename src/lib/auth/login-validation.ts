const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface LoginCredentials {
  email: string;
  password: string;
}

export function parseLoginCredentials(body: unknown): LoginCredentials | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const values = body as Record<string, unknown>;
  if (
    Object.keys(values).some((key) => key !== "email" && key !== "password") ||
    typeof values.email !== "string" ||
    typeof values.password !== "string"
  ) {
    return null;
  }

  const email = values.email.trim().toLowerCase();

  if (
    email.length === 0 ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(email) ||
    values.password.length > MAX_PASSWORD_LENGTH
  ) {
    return null;
  }

  return { email, password: values.password };
}
