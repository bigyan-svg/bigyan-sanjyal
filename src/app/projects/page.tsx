import type { Metadata } from "next";
import { Suspense } from "react";
import { AlertCircle, ArrowRight, ArrowUpRight, FolderKanban } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import { prisma } from "@/lib/prisma";
import { isSafePublicProjectUrl } from "@/lib/project-validation";
import { ProjectImageGallery } from "./project-image-gallery";

export const metadata: Metadata = {
  title: "Projects",
  description: "Published projects by Bigyan Sanjyal.",
};

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsPageLoading />}>
      <PublishedProjects />
    </Suspense>
  );
}

async function PublishedProjects() {
  let projects;

  try {
    projects = await prisma.project.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        slug: true,
        summary: true,
        description: true,
        featured: true,
        sortOrder: true,
        category: { select: { name: true } },
        skills: {
          where: { skill: { is: { status: "PUBLISHED" } } },
          orderBy: [{ skill: { sortOrder: "asc" } }, { skill: { name: "asc" } }],
          select: { skill: { select: { id: true, name: true } } },
        },
        links: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, type: true, label: true, url: true },
        },
        images: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, imageUrl: true, altText: true, caption: true },
        },
      },
    });
  } catch {
    return (
      <>
        <PageIntro
          description="A collection of work, experiments, and things built while learning."
          eyebrow="Projects / 03"
          id="projects-title"
          title="Selected projects."
        />
        <section aria-labelledby="projects-list-title" className="section page-content">
          <Container>
            <SectionHeading
              description="Only published projects are shown here."
              eyebrow="Projects"
              id="projects-list-title"
              title="Selected work."
            />
            <Card className="public-projects__error" variant="outlined" role="alert">
              <AlertCircle aria-hidden="true" size={20} />
              <p>Projects are temporarily unavailable. Please try again later.</p>
            </Card>
          </Container>
        </section>
      </>
    );
  }

  return (
    <>
      <PageIntro
        description="A collection of work, experiments, and things built while learning."
        eyebrow="Projects / 03"
        id="projects-title"
        title="Selected projects."
      />
      <section aria-labelledby="projects-list-title" className="section page-content">
        <Container>
          <SectionHeading
            description="Published projects, their technologies, and related resources."
            eyebrow="Projects"
            id="projects-list-title"
            title="Selected work."
          />

          {projects.length === 0 ? (
            <EmptyState
              action={
                <ButtonLink href="/about" variant="secondary">
                  About my journey <ArrowRight aria-hidden="true" size={16} />
                </ButtonLink>
              }
              description="There are no published projects to display yet. Project details will appear here when they are ready to share."
              eyebrow="No published projects"
              icon={<FolderKanban size={23} />}
              title="Projects will appear here when published."
            />
          ) : (
            <div className="public-projects__list">
              {projects.map((project) => {
                const images = project.images.filter((image) => isSafePublicProjectUrl(image.imageUrl));
                const links = project.links.filter((link) => isSafePublicProjectUrl(link.url));

                return (
                  <article
                    aria-labelledby={`public-project-${project.id}`}
                    className={`public-projects__card${project.featured ? " public-projects__card--featured" : ""}${images.length === 0 ? " public-projects__card--text-only" : ""}`}
                    key={project.id}
                  >
                    {images.length > 0 ? (
                      <ProjectImageGallery images={images} projectTitle={project.title} />
                    ) : null}

                    <div className="public-projects__content">
                      <div className="public-projects__heading">
                        <div>
                          {project.category ? <p className="eyebrow">{project.category.name}</p> : null}
                          <h3 id={`public-project-${project.id}`}>{project.title}</h3>
                        </div>
                        {project.featured ? <span className="public-projects__featured">Featured</span> : null}
                      </div>

                      <p className="public-projects__summary">{project.summary}</p>
                      {project.description ? <p className="public-projects__description">{project.description}</p> : null}

                      {project.skills.length > 0 ? (
                        <div aria-label="Published skills used" className="public-projects__skills">
                          {project.skills.map(({ skill }) => (
                            <span className="public-projects__skill" key={skill.id}>{skill.name}</span>
                          ))}
                        </div>
                      ) : null}

                      {links.length > 0 ? (
                        <ul aria-label="Project links" className="public-projects__links">
                          {links.map((link) => (
                            <li key={link.id}>
                              <a href={link.url} rel="noopener noreferrer" referrerPolicy="no-referrer" target="_blank">
                                <span>{link.label}</span>
                                <span className="public-projects__link-type">{projectLinkTypeLabel(link.type)}</span>
                                <ArrowUpRight aria-hidden="true" size={15} />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Container>
      </section>
    </>
  );
}

function projectLinkTypeLabel(type: string): string {
  switch (type) {
    case "GITHUB_REPOSITORY":
      return "GitHub Repository";
    case "LIVE_DEMO":
      return "Live Demo";
    case "DOCUMENTATION":
      return "Documentation";
    default:
      return "Other";
  }
}

function ProjectsPageLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading published projects…</p>
      </Container>
    </section>
  );
}
