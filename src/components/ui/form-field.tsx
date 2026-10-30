import type {
  InputHTMLAttributes,
  Ref,
  TextareaHTMLAttributes,
} from "react";

interface FieldTextProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

type TextInputProps = FieldTextProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
    inputRef?: Ref<HTMLInputElement>;
  };

type TextAreaProps = FieldTextProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

function FieldMessage({
  id,
  hint,
  error,
}: {
  id: string;
  hint?: string;
  error?: string;
}) {
  const message = error ?? hint;

  if (!message) return null;

  return (
    <span
      className={error ? "form-field__message form-field__message--error" : "form-field__message"}
      id={`${id}-message`}
    >
      {message}
    </span>
  );
}

export function TextInput({
  id,
  label,
  hint,
  error,
  inputRef,
  className,
  "aria-describedby": ariaDescribedBy,
  ...props
}: TextInputProps) {
  const messageId = error || hint ? `${id}-message` : undefined;
  const describedBy = [ariaDescribedBy, messageId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        className={["form-control", className].filter(Boolean).join(" ")}
        id={id}
        ref={inputRef}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      <FieldMessage id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({
  id,
  label,
  hint,
  error,
  className,
  "aria-describedby": ariaDescribedBy,
  ...props
}: TextAreaProps) {
  const messageId = error || hint ? `${id}-message` : undefined;
  const describedBy = [ariaDescribedBy, messageId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        className={["form-control", "form-control--textarea", className]
          .filter(Boolean)
          .join(" ")}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      <FieldMessage id={id} hint={hint} error={error} />
    </div>
  );
}
