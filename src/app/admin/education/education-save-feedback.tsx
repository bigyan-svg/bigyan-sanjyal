interface EducationSaveFeedbackProps {
  message: string;
}

export function EducationSaveFeedback({ message }: EducationSaveFeedbackProps) {
  if (!message) return null;

  return (
    <p
      className="education-management__feedback education-management__feedback--success"
      role="status"
      aria-live="polite"
    >
      {message}
    </p>
  );
}
