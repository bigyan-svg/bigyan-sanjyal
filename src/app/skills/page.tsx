import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCircle, Braces } from "lucide-react";
import { SkillIcon } from "@/components/skills/skill-icon";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Skills",
  description: "Published skills and proficiency details.",
};

export default function SkillsPage() {
  return (
    <Suspense fallback={<SkillsPageLoading />}>
      <PublishedSkills />
    </Suspense>
  );
}

async function PublishedSkills() {
  let categories;

  try {
    categories = await prisma.skillCategory.findMany({
      where: { skills: { some: { status: "PUBLISHED" } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        skills: {
          where: { status: "PUBLISHED" },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            icon: true,
            description: true,
            proficiencyLabel: true,
            sortOrder: true,
          },
        },
      },
    });
  } catch {
    return (
      <>
        <PageIntro
          description="Published skills and proficiency details."
          eyebrow="Skills / 02"
          id="skills-title"
          title="Tools and technologies."
        />
        <section aria-labelledby="skills-list-title" className="section page-content">
          <Container>
            <SectionHeading
              description="Only published skills are shown here."
              eyebrow="Skills"
              id="skills-list-title"
              title="Skills by category."
            />
            <Card className="public-skills__error" variant="outlined" role="alert">
              <AlertCircle aria-hidden="true" size={20} />
              <p>Skills are temporarily unavailable. Please try again later.</p>
            </Card>
          </Container>
        </section>
      </>
    );
  }

  return (
    <>
      <PageIntro
        description="Skills and proficiency details that have been confirmed and published."
        eyebrow="Skills / 02"
        id="skills-title"
        title="Tools and technologies."
      />

      <section aria-labelledby="skills-list-title" className="section page-content">
        <Container>
          <SectionHeading
            description="Published skills are grouped by category and ordered for easy browsing."
            eyebrow="Skills"
            id="skills-list-title"
            title="Skills by category."
          />

          {categories.length === 0 ? (
            <EmptyState
              description="There are no published skills to display yet."
              eyebrow="No published skills"
              icon={<Braces size={22} />}
              title="Skills will appear here when published."
            />
          ) : (
            <div className="public-skills__categories">
              {categories.map((category) => (
                <section
                  aria-labelledby={`public-skill-category-${category.id}`}
                  className="public-skills__category"
                  key={category.id}
                >
                  <header className="public-skills__category-heading">
                    <p className="eyebrow">Category</p>
                    <h2 id={`public-skill-category-${category.id}`}>{category.name}</h2>
                  </header>
                  <ul className="public-skills__list">
                    {category.skills.map((skill) => (
                      <li key={skill.id}>
                        <Card className="public-skills__card" variant="outlined">
                          <div className="public-skills__card-heading">
                            {skill.icon ? (
                              <span aria-hidden="true" className="public-skills__icon">
                                <SkillIcon name={skill.icon} size={19} />
                              </span>
                            ) : null}
                            <h3>{skill.name}</h3>
                          </div>
                          {skill.proficiencyLabel ? (
                            <span className="status-label public-skills__level">
                              {skill.proficiencyLabel}
                            </span>
                          ) : null}
                          {skill.description ? <p>{skill.description}</p> : null}
                        </Card>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Container>
      </section>
    </>
  );
}

function SkillsPageLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading published skills…</p>
      </Container>
    </section>
  );
}
