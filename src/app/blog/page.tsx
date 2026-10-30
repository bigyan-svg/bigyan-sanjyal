import type { Metadata } from "next";
import { ArrowRight, BookOpenText } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { PageIntro } from "@/components/ui/page-intro";

export const metadata: Metadata = {
  title: "Blog and Journal",
  description:
    "Writing by Bigyan Sanjyal. Articles, learning notes, and personal reflections will appear here when provided.",
};

export default function BlogPage() {
  return (
    <>
      <PageIntro
        description="Articles, notes, and reflections can live here as the learning journey grows."
        eyebrow="Blog / 04"
        id="blog-title"
        title="Writing and ideas."
      />
      <section aria-labelledby="journal-list-title" className="section page-content">
        <Container>
          <h2 className="sr-only" id="journal-list-title">
            Article list
          </h2>
          <EmptyState
            action={
              <ButtonLink href="/projects" variant="secondary">
                Explore projects <ArrowRight aria-hidden="true" size={16} />
              </ButtonLink>
            }
            description="No articles or journal entries have been supplied yet. Published writing will be listed here once it is ready to share."
            eyebrow="Journal"
            icon={<BookOpenText size={23} />}
            title="Writing will appear here."
          />
        </Container>
      </section>
    </>
  );
}
