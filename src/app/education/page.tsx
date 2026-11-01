import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCircle, GraduationCap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import { EducationEntry } from "@/app/education/education-entry";
import { getPublishedEducation } from "@/lib/public-education";

export const metadata: Metadata = {
  title: "Education",
  description: "Published education records and study timelines.",
};

export default function EducationPage() {
  return (
    <div className="education-page">
      <PageIntro
        description="A record of published education details and study timelines."
        eyebrow="Education / 05"
        id="education-title"
        title="Education."
      />
      <Suspense fallback={<EducationLoading />}>
        <PublishedEducation />
      </Suspense>
    </div>
  );
}

async function PublishedEducation() {
  const result = await getPublishedEducation();

  return (
    <section aria-labelledby="education-list-title" className="section page-content public-education">
      <Container className="public-education__container">
        <SectionHeading
          description="Only published education records are shown here."
          eyebrow="Academic timeline"
          id="education-list-title"
          title="Education timeline."
        />

        {result.kind === "unavailable" ? (
          <Card className="public-education__error" variant="outlined" role="alert">
            <AlertCircle aria-hidden="true" size={20} />
            <p>Education details are temporarily unavailable. Please try again later.</p>
          </Card>
        ) : result.education.length === 0 ? (
          <div className="public-education__state">
            <EmptyState
              description="There are no published education records to display yet."
              eyebrow="No published education"
              icon={<GraduationCap size={22} />}
              title="Education details will appear here when published."
            />
          </div>
        ) : (
          <ol
            aria-label="Published education records, ordered by display order and start date"
            className="public-education__timeline"
          >
            {result.education.map((item, index) => (
              <li className="public-education__timeline-item" key={index}>
                <span aria-hidden="true" className="public-education__marker" />
                <EducationEntry education={item} />
              </li>
            ))}
          </ol>
        )}
      </Container>
    </section>
  );
}

function EducationLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">
          Loading published education records…
        </p>
      </Container>
    </section>
  );
}
