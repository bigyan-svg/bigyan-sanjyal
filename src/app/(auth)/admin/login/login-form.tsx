"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/form-field";

const MAX_EMAIL_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const GENERIC_LOGIN_ERROR =
  "We couldn't sign you in. Check your email and password, then try again.";

interface FieldErrors {
  email?: string;
  password?: string;
}

export function AdminLoginForm() {
  const router = useRouter();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    const nextErrors: FieldErrors = {};

    if (!normalizedEmail) {
      nextErrors.email = "Enter your email address.";
    } else if (
      normalizedEmail.length > MAX_EMAIL_LENGTH ||
      !EMAIL_PATTERN.test(normalizedEmail)
    ) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!password) {
      nextErrors.password = "Enter your password.";
    } else if (password.length > MAX_PASSWORD_LENGTH) {
      nextErrors.password = "Your password is too long.";
    }

    setFieldErrors(nextErrors);
    setFormError("");

    if (nextErrors.email || nextErrors.password) {
      if (nextErrors.email) {
        emailInputRef.current?.focus();
      } else {
        passwordInputRef.current?.focus();
      }
      return;
    }

    setEmail(normalizedEmail);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      if (!response.ok) {
        setFormError(GENERIC_LOGIN_ERROR);
        setPassword("");
        passwordInputRef.current?.focus();
        return;
      }

      setEmail("");
      setPassword("");
      setIsPasswordVisible(false);
      router.replace("/admin");
    } catch {
      setFormError(GENERIC_LOGIN_ERROR);
      setPassword("");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-busy={isSubmitting}
      className="admin-login__form"
      noValidate
      onSubmit={handleSubmit}
    >
      <TextInput
        autoCapitalize="none"
        autoComplete="username"
        disabled={isSubmitting}
        error={fieldErrors.email}
        id="admin-email"
        label="Email address"
        maxLength={MAX_EMAIL_LENGTH}
        name="username"
        onChange={(event) => {
          setEmail(event.currentTarget.value);
          setFieldErrors((current) => ({ ...current, email: undefined }));
          setFormError("");
        }}
        inputRef={emailInputRef}
        required
        spellCheck={false}
        type="email"
        value={email}
      />

      <div className="form-field">
        <label className="form-field__label" htmlFor="admin-password">
          Password
        </label>
        <div className="admin-login__password-wrap">
          <input
            aria-describedby={
              fieldErrors.password ? "admin-password-message" : undefined
            }
            aria-invalid={fieldErrors.password ? true : undefined}
            autoComplete="current-password"
            className="form-control admin-login__password-input"
            disabled={isSubmitting}
            id="admin-password"
            maxLength={MAX_PASSWORD_LENGTH}
            name="password"
            onChange={(event) => {
              setPassword(event.currentTarget.value);
              setFieldErrors((current) => ({ ...current, password: undefined }));
              setFormError("");
            }}
            ref={passwordInputRef}
            required
            type={isPasswordVisible ? "text" : "password"}
            value={password}
          />
          <button
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            className="admin-login__password-toggle"
            disabled={isSubmitting}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            type="button"
          >
            {isPasswordVisible ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
            <span>{isPasswordVisible ? "Hide" : "Show"}</span>
          </button>
        </div>
        {fieldErrors.password ? (
          <span
            className="form-field__message form-field__message--error"
            id="admin-password-message"
            role="alert"
          >
            {fieldErrors.password}
          </span>
        ) : null}
      </div>

      {formError ? (
        <p className="admin-login__error" role="alert">
          {formError}
        </p>
      ) : null}

      <Button
        className="admin-login__submit"
        disabled={isSubmitting}
        size="large"
        type="submit"
      >
        {isSubmitting ? (
          <>
            <LoaderCircle
              aria-hidden="true"
              className="admin-login__spinner"
              size={18}
            />
            Signing in
          </>
        ) : (
          <>
            Sign in
            <ArrowRight aria-hidden="true" size={17} />
          </>
        )}
      </Button>

      <span aria-live="polite" className="sr-only" role="status">
        {isSubmitting ? "Signing in." : ""}
      </span>
    </form>
  );
}
