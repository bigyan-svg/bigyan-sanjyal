import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCircle, BriefcaseBusiness, CalendarDays, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatWorkExperienceDateRange } from "@/lib/public-experience-format";
import { getPublishedWorkExperiences } from "@/lib/public-experience";

export const metadata: Metadata = {
  title: "Work Experience",
  description: "Published work experience records and role timelines.",
};

export default function ExperiencePage() {
  return (
    <>
      <PageIntro
        description="A timeline of published work experience details."
        eyebrow="Experience"
        id="experience-title"
        title="Work experience."
      />
      <Suspense fallback={<ExperienceLoading />}>
        <PublishedExperience />
      </Suspense>
    </>
  );
}

async function PublishedExperience() {
  const result = await getPublishedWorkExperiences();

  return (
    <section aria-labelledby="experience-list-title" className="section page-content">
      <Container>
        <SectionHeading
          description="Only published experience records are shown here."
          eyebrow="Professional timeline"
          id="experience-list-title"
          title="Experience timeline."
        />

        {result.kind === "unavailable" ? (
          <Card className="public-experience__error" variant="outlined" role="alert">
            <AlertCircle aria-hidden="true" size={20} />
            <p>Work experience is temporarily unavailable. Please try again later.</p>
          </Card>
        ) : result.experiences.length === 0 ? (
          <EmptyState
            description="There are no published work experience records to display yet."
            eyebrow="No published experience"
            icon={<BriefcaseBusiness size={22} />}
            title="Experience details will appear here when published."
          />
        ) : (
          <ol aria-label="Published work experience, ordered by display order and start date" className="public-experience__timeline">
            {result.experiences.map((experience, index) => {
              const dateRange = formatWorkExperienceDateRange(experience);

              return (
                <li className="public-experience__timeline-item" key={index}>
                  <span aria-hidden="true" className="public-experience__marker" />
                  <Card className="public-experience__entry" variant="outlined">
                    <header className="public-experience__heading">
                      <div className="public-experience__heading-copy">
                        <h3>{experience.roleTitle}</h3>
                        <p className="public-experience__employer">{experience.employer}</p>
                      </div>
                      {experience.isCurrent ? (
                        <span className="public-experience__current">Current</span>
                      ) : null}
                    </header>

                    <p className="public-experience__dates">
                      <CalendarDays aria-hidden="true" size={15} />
                      <span>{dateRange}</span>
                    </p>

                    {experience.location ? (
                      <p className="public-experience__location">
                        <MapPin aria-hidden="true" size={15} />
                        <span>{experience.location}</span>
                      </p>
                    ) : null}

                    {experience.description ? (
                      <p className="public-experience__description">{experience.description}</p>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </Container>
    </section>
  );
}

function ExperienceLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading published work experience…</p>
      </Container>
    </section>
  );
}
