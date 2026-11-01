import { BookOpen, CalendarDays } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatEducationDate, formatEducationDateRange } from "@/lib/public-education-format";
import type { PublicEducation } from "@/lib/public-education-query";

export function EducationEntry({ education }: { education: PublicEducation }) {
  const startDateLabel = formatEducationDate(education.startDate);
  const endDateLabel = education.isCurrent ? null : formatEducationDate(education.endDate);
  const dateRange = formatEducationDateRange(education);

  return (
    <Card className="public-education__entry" variant="outlined">
      <header className="public-education__heading">
        <div className="public-education__heading-copy">
          <h3 className="public-education__institution">{education.institution}</h3>
          <p className="public-education__program">{education.program}</p>
        </div>
        {education.isCurrent ? (
          <span className="public-education__current">
            <span aria-hidden="true" className="public-education__current-dot" />
            Currently studying
          </span>
        ) : null}
      </header>

      {education.fieldOfStudy || dateRange ? (
        <div className="public-education__metadata">
          {education.fieldOfStudy ? (
            <p className="public-education__field">
              <BookOpen aria-hidden="true" size={15} />
              <span>
                <span className="sr-only">Field of study: </span>
                {education.fieldOfStudy}
              </span>
            </p>
          ) : null}

          {dateRange ? (
            <p className="public-education__dates">
              <CalendarDays aria-hidden="true" size={15} />
              <span>
                <span className="sr-only">Study period: </span>
                {startDateLabel ? (
                  <>
                    {!endDateLabel && !education.isCurrent ? "From " : null}
                    <time dateTime={education.startDate?.toISOString().slice(0, 10)}>
                      {startDateLabel}
                    </time>
                    {endDateLabel || education.isCurrent ? " – " : null}
                    {endDateLabel ? (
                      <time dateTime={education.endDate?.toISOString().slice(0, 10)}>
                        {endDateLabel}
                      </time>
                    ) : education.isCurrent ? (
                      "Present"
                    ) : null}
                  </>
                ) : endDateLabel ? (
                  <>
                    Through{" "}
                    <time dateTime={education.endDate?.toISOString().slice(0, 10)}>
                      {endDateLabel}
                    </time>
                  </>
                ) : education.isCurrent ? (
                  "Present"
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {education.description ? (
        <div className="public-education__description-wrap">
          <p className="public-education__description">{education.description}</p>
        </div>
      ) : null}
    </Card>
  );
}
