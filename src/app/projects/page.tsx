import type { Metadata } from "next";
import { ArrowRight, FolderKanban } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Projects by Bigyan Sanjyal. Project descriptions and links will appear here when they are ready to share.",
};

export default function ProjectsPage() {
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
          <h2 className="sr-only" id="projects-list-title">
            Project list
          </h2>
          <EmptyState
            action={
              <ButtonLink href="/about" variant="secondary">
                About my journey <ArrowRight aria-hidden="true" size={16} />
              </ButtonLink>
            }
            description="Project details, images, technologies, and links have not been added yet. This page will list confirmed work once it is ready to publish."
            eyebrow="Project portfolio"
            icon={<FolderKanban size={23} />}
            title="Project details will appear here."
          />
        </Container>
      </section>
    </>
  );
}
