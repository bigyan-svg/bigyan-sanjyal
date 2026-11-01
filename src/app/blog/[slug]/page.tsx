import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getPublishedBlogPostBySlug } from "@/lib/public-blog";
import {
  getPublishedBlogArticleMetadata,
  splitBlogBodyIntoParagraphs,
} from "@/lib/public-blog-query";

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
};

export const instant = false;

export async function generateMetadata({ params }: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedBlogPostBySlug(slug);
  const articleMetadata = getPublishedBlogArticleMetadata(result);

  return articleMetadata ?? {};
}

export default function BlogArticlePage({ params }: BlogArticlePageProps) {
  return (
    <Suspense fallback={<BlogArticleLoading />}>
      <PublishedBlogArticle params={params} />
    </Suspense>
  );
}

async function PublishedBlogArticle({ params }: BlogArticlePageProps) {
  const { slug } = await params;
  const result = await getPublishedBlogPostBySlug(slug);

  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable") return <BlogArticleUnavailable />;

  const { post } = result;
  const paragraphs = splitBlogBodyIntoParagraphs(post.body);

  return (
    <article aria-labelledby="blog-article-title">
      <header className="page-intro">
        <Container>
          <p className="eyebrow">Blog / Article</p>
          <h1 id="blog-article-title">{post.title}</h1>
          {post.excerpt ? <p className="page-intro__description">{post.excerpt}</p> : null}

          <div className="public-blog-article__details">
            <time dateTime={post.publishedAt.toISOString()}>
              {formatPublicationDate(post.publishedAt)}
            </time>
            {post.category ? (
              <span className="public-blog__category">{post.category.name}</span>
            ) : null}
            {post.tags.length > 0 ? (
              <ul aria-label="Article tags" className="public-blog-article__tags">
                {post.tags.map(({ tag }) => (
                  <li key={tag.id}>{tag.name}</li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="page-intro__actions">
            <ButtonLink href="/blog" variant="secondary">
              <ArrowLeft aria-hidden="true" size={16} /> Back to all articles
            </ButtonLink>
          </div>
        </Container>
      </header>

      <section aria-label="Article content" className="section page-content">
        <Container>
          <div className="public-blog-article__body">
            {paragraphs.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </div>
        </Container>
      </section>
    </article>
  );
}

function BlogArticleUnavailable() {
  return (
    <>
      <header className="page-intro">
        <Container>
          <p className="eyebrow">Blog</p>
          <h1>Article temporarily unavailable.</h1>
          <p className="page-intro__description">
            This article could not be loaded right now. Please try again later.
          </p>
        </Container>
      </header>
      <section aria-label="Article status" className="section page-content">
        <Container>
          <Card className="public-blog-article__error" variant="outlined" role="alert">
            <AlertCircle aria-hidden="true" size={20} />
            <p>Article content is temporarily unavailable.</p>
          </Card>
          <div className="page-intro__actions">
            <ButtonLink href="/blog" variant="secondary">
              <ArrowLeft aria-hidden="true" size={16} /> Back to all articles
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}

function BlogArticleLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading article…</p>
      </Container>
    </section>
  );
}

function formatPublicationDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}
