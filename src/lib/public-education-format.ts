export interface EducationDateRangeInput {
  startDate: Date | null;
  endDate: Date | null;
  isCurrent: boolean;
}

const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatEducationDate(value: Date | null): string | null {
  if (!value || !Number.isFinite(value.getTime())) {
    return null;
  }

  return monthYearFormatter.format(value);
}

export function formatEducationDateRange(
  education: EducationDateRangeInput,
): string | null {
  const start = formatEducationDate(education.startDate);
  const end = formatEducationDate(education.endDate);

  if (education.isCurrent) {
    return start ? `${start} – Present` : "Present";
  }

  if (start && end) {
    return `${start} – ${end}`;
  }

  if (start) {
    return `From ${start}`;
  }

  if (end) {
    return `Through ${end}`;
  }

  return null;
}
