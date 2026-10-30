import type { Metadata } from "next";
import { ArrowRight, GraduationCap } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";

export const metadata: Metadata = {
  title: "Education",
  description:
    "The academic journey of Bigyan Sanjyal, a Computer Engineering student. Institution and timeline details will be added when confirmed.",
};

export default function EducationPage() {
  return (
    <>
      <PageIntro
        description="A record of study, coursework, and milestones, added only when the details are confirmed."
        eyebrow="Education / 05"
        id="education-title"
        title="My academic journey."
      />
      <section aria-labelledby="current-study-title" className="section page-content">
        <Container>
          <SectionHeading
            description="Only the current field of study is confirmed so far."
            eyebrow="Current study"
            id="current-study-title"
            title="Education details."
          />
          <Card className="education-card" variant="glow">
            <span aria-hidden="true" className="destination-card__icon">
              <GraduationCap size={20} />
            </span>
            <div className="education-card__main">
              <p className="eyebrow">Program</p>
              <h2>Computer Engineering</h2>
              <p className="education-card__status">Current student</p>
            </div>
            <div className="education-card__details">
              <p>
                Institution, study dates, semester, coursework, and academic
                achievements have not been provided yet.
              </p>
              <ButtonLink href="/about" size="small" variant="subtle">
                About me <ArrowRight aria-hidden="true" size={15} />
              </ButtonLink>
            </div>
          </Card>
        </Container>
      </section>
    </>
  );
}
