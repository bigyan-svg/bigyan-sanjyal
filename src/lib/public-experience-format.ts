export interface WorkExperienceDateRangeInput {
  startDate: Date | null;
  endDate: Date | null;
  isCurrent: boolean;
}

const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatMonthYear(value: Date | null): string {
  if (!value || !Number.isFinite(value.getTime())) {
    return "Date not provided";
  }

  return monthYearFormatter.format(value);
}

export function formatWorkExperienceDateRange(
  experience: WorkExperienceDateRangeInput,
): string {
  const start = formatMonthYear(experience.startDate);
  const end = experience.isCurrent ? "Present" : formatMonthYear(experience.endDate);

  return `${start} – ${end}`;
}
