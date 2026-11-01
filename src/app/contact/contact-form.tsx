"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextArea, TextInput } from "@/components/ui/form-field";

const FIELD_NAMES = ["name", "email", "subject", "message"] as const;

type FieldName = (typeof FIELD_NAMES)[number];
type ContactValues = Record<FieldName, string> & { website: string };
type FieldErrors = Partial<Record<FieldName, string>>;
type FormStatus =
  | "idle"
  | "submitting"
  | "success"
  | "validation-error"
  | "server-error"
  | "rate-limited";

interface SubmissionResponse {
  success?: unknown;
  fields?: unknown;
}

const INITIAL_VALUES: ContactValues = {
  name: "",
  email: "",
  subject: "",
  message: "",
  website: "",
};

function getFieldErrors(value: unknown): FieldErrors {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const errors: FieldErrors = {};
  for (const field of FIELD_NAMES) {
    const message = (value as Record<string, unknown>)[field];
    if (typeof message === "string") errors[field] = message;
  }
  return errors;
}

function statusMessage(status: FormStatus): string | null {
  switch (status) {
    case "submitting":
      return "Sending your message…";
    case "success":
      return "Your message has been sent. Thank you for getting in touch.";
    case "server-error":
      return "We could not send your message. Please try again later.";
    case "rate-limited":
      return "Too many messages have been submitted. Please wait a little while and try again.";
    case "validation-error":
      return "Please correct the highlighted fields and try again.";
    default:
      return null;
  }
}

export function ContactForm() {
  const [values, setValues] = useState<ContactValues>(INITIAL_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalidFieldRef = useRef(false);

  useEffect(() => {
    if (!focusInvalidFieldRef.current) return;
    focusInvalidFieldRef.current = false;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [fieldErrors]);

  function updateField(field: FieldName, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    submittingRef.current = true;
    setFieldErrors({});
    setStatus("submitting");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
        cache: "no-store",
        credentials: "same-origin",
      });

      let result: SubmissionResponse = {};
      try {
        const payload: unknown = await response.json();
        if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
          result = payload as SubmissionResponse;
        }
      } catch {
        // Treat malformed responses like other safe submission failures.
      }

      if (response.status === 429) {
        setStatus("rate-limited");
        return;
      }

      if (response.status === 422) {
        const errors = getFieldErrors(result.fields);
        if (Object.keys(errors).length > 0) {
          focusInvalidFieldRef.current = true;
          setFieldErrors(errors);
          setStatus("validation-error");
          return;
        }
      }

      if (response.ok && response.status === 201 && result.success === true) {
        setValues(INITIAL_VALUES);
        setFieldErrors({});
        setStatus("success");
        return;
      }

      setStatus("server-error");
    } catch {
      setStatus("server-error");
    } finally {
      submittingRef.current = false;
    }
  }

  const message = statusMessage(status);
  const isSubmitting = status === "submitting";
  const feedbackClass = [
    "contact-form__notice",
    "contact-form__feedback",
    message ? `contact-form__feedback--${status}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {message ? (
        <div
          aria-live={status === "success" || status === "submitting" ? "polite" : "assertive"}
          className={feedbackClass}
          role={status === "success" || status === "submitting" ? "status" : "alert"}
        >
          {status === "success" ? (
            <CheckCircle2 aria-hidden="true" size={19} />
          ) : status === "submitting" ? (
            <LoaderCircle aria-hidden="true" size={19} />
          ) : (
            <AlertCircle aria-hidden="true" size={19} />
          )}
          <div>
            <strong>
              {status === "success"
                ? "Message sent"
                : status === "submitting"
                  ? "Sending"
                  : status === "rate-limited"
                    ? "Please wait before trying again"
                    : status === "validation-error"
                      ? "Check your message"
                      : "Message not sent"}
            </strong>
            <p>{message}</p>
          </div>
        </div>
      ) : null}

      <form
        aria-busy={isSubmitting}
        className="contact-form"
        onSubmit={handleSubmit}
        ref={formRef}
      >
        <fieldset disabled={isSubmitting}>
          <legend className="sr-only">Send a contact message</legend>
          <div className="contact-form__row">
            <TextInput
              autoComplete="name"
              error={fieldErrors.name}
              id="name"
              label="Your name"
              maxLength={120}
              name="name"
              onChange={(event) => updateField("name", event.currentTarget.value)}
              placeholder="Name"
              required
              value={values.name}
            />
            <TextInput
              autoComplete="email"
              error={fieldErrors.email}
              id="email"
              label="Email address"
              maxLength={320}
              name="email"
              onChange={(event) => updateField("email", event.currentTarget.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={values.email}
            />
          </div>
          <TextInput
            error={fieldErrors.subject}
            id="subject"
            label="Subject"
            maxLength={200}
            name="subject"
            onChange={(event) => updateField("subject", event.currentTarget.value)}
            placeholder="What is this about?"
            value={values.subject}
          />
          <TextArea
            error={fieldErrors.message}
            id="message"
            label="Message"
            maxLength={10_000}
            name="message"
            onChange={(event) => updateField("message", event.currentTarget.value)}
            placeholder="Write your message…"
            required
            rows={5}
            value={values.message}
          />
          <div className="sr-only">
            <TextInput
              autoComplete="off"
              hint="If you use assistive technology, leave this field empty."
              id="website"
              label="Leave this field blank"
              name="website"
              onChange={(event) => {
                const website = event.currentTarget.value;
                setValues((current) => ({ ...current, website }));
              }}
              tabIndex={-1}
              value={values.website}
            />
          </div>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Sending…" : "Send message"}
          </Button>
        </fieldset>
      </form>
    </>
  );
}
