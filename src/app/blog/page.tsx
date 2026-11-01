import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertCircle, ArrowRight, BookOpenText } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/form-field";
import { PageIntro } from "@/components/ui/page-intro";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  buildBlogListingHref,
  PUBLIC_BLOG_PAGE_SIZE,
  type BlogListingFilters,
  type BlogListingSearchParams,
} from "@/lib/public-blog-query";
import { getPublicBlogListing } from "@/lib/public-blog";

export const metadata: Metadata = {
  title: "Blog and Journal",
  description: "Published articles, learning notes, and reflections by Bigyan Sanjyal.",
};

export default function BlogPage({
  searchParams,
}: {
  searchParams: Promise<BlogListingSearchParams>;
}) {
  return (
    <>
      <PageIntro
        description="Articles, notes, and reflections from the learning journey."
        eyebrow="Blog / 04"
        id="blog-title"
        title="Writing and ideas."
      />
      <Suspense fallback={<BlogPageLoading />}>
        <PublishedBlogPosts searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PublishedBlogPosts({
  searchParams,
}: {
  searchParams: Promise<BlogListingSearchParams>;
}) {
  const result = await getPublicBlogListing(await searchParams);

  return (
    <section aria-labelledby="blog-list-title" className="section page-content">
      <Container>
        <SectionHeading
          description="Published articles and notes."
          eyebrow="Journal"
          id="blog-list-title"
          title="Latest writing."
        />

        {result.kind === "unavailable" ? (
          <Card className="public-blog__error" variant="outlined" role="alert">
            <AlertCircle aria-hidden="true" size={20} />
            <p>Articles are temporarily unavailable. Please try again later.</p>
          </Card>
        ) : (
          <>
            <BlogFilterControls
              categories={result.categories}
              filters={result.filters}
              tags={result.tags}
            />
            <p aria-live="polite" className="public-blog__result-count" role="status">
              {result.totalCount === 0
                ? "No matching articles"
                : `Showing ${(result.page - 1) * PUBLIC_BLOG_PAGE_SIZE + 1}–${Math.min(result.page * PUBLIC_BLOG_PAGE_SIZE, result.totalCount)} of ${result.totalCount} ${result.totalCount === 1 ? "article" : "articles"}`}
            </p>

            {result.posts.length === 0 ? (
              <EmptyState
                action={hasBlogFilters(result.filters) ? (
                  <ButtonLink href="/blog" variant="secondary">Clear all filters</ButtonLink>
                ) : (
                  <ButtonLink href="/projects" variant="secondary">
                    Explore projects <ArrowRight aria-hidden="true" size={16} />
                  </ButtonLink>
                )}
                description={hasBlogFilters(result.filters)
                  ? "No published articles match these search and filter settings. Try changing them or clear all filters."
                  : "There are no published articles to display yet. New writing will appear here when it is ready to share."}
                eyebrow={hasBlogFilters(result.filters) ? "No matching articles" : "No published articles"}
                icon={<BookOpenText size={23} />}
                title={hasBlogFilters(result.filters)
                  ? "Try another search or filter combination."
                  : "Writing will appear here when published."}
              />
            ) : (
              <div className="public-blog__grid">
                {result.posts.map((post) => (
                  <Card className="public-blog__card" key={post.id}>
                    <div className="public-blog__meta">
                      {post.publishedAt ? (
                        <time dateTime={post.publishedAt.toISOString()}>
                          {formatPublicationDate(post.publishedAt)}
                        </time>
                      ) : null}
                      {post.category ? (
                        <span className="public-blog__category">{post.category.name}</span>
                      ) : null}
                    </div>

                    <h3 className="public-blog__title">{post.title}</h3>
                    {post.excerpt ? <p className="public-blog__excerpt">{post.excerpt}</p> : null}

                    {post.tags.length > 0 ? (
                      <ul aria-label={`Tags for ${post.title}`} className="public-blog__tags">
                        {post.tags.map(({ tag }) => (
                          <li key={tag.id}>{tag.name}</li>
                        ))}
                      </ul>
                    ) : null}

                    <Link
                      aria-label={`Read ${post.title}`}
                      className="public-blog__read-link"
                      href={`/blog/${post.slug}`}
                    >
                      Read article <ArrowRight aria-hidden="true" size={16} />
                    </Link>
                  </Card>
                ))}
              </div>
            )}
            <BlogPagination filters={result.filters} page={result.page} totalPages={result.totalPages} />
          </>
        )}
      </Container>
    </section>
  );
}

function BlogFilterControls({
  categories,
  filters,
  tags,
}: {
  categories: Array<{ name: string; slug: string }>;
  filters: BlogListingFilters;
  tags: Array<{ name: string; slug: string }>;
}) {
  return (
    <div className="public-blog__filter-panel">
      <form action="/blog" className="public-blog__filters" method="get">
        <TextInput
          id="blog-search"
          label="Search articles"
          maxLength={100}
          name="q"
          placeholder="Search titles and excerpts"
          type="search"
          defaultValue={filters.search}
        />

        <div className="form-field">
          <label className="form-field__label" htmlFor="blog-category-filter">Category</label>
          <select className="form-control" defaultValue={filters.category} id="blog-category-filter" name="category">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.slug} value={category.slug}>{category.name}</option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor="blog-tag-filter">Tag</label>
          <select className="form-control" defaultValue={filters.tag} id="blog-tag-filter" name="tag">
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.slug} value={tag.slug}>{tag.name}</option>
            ))}
          </select>
        </div>

        <Button size="small" type="submit">Apply filters</Button>
      </form>

      {hasBlogFilters(filters) ? (
        <div className="public-blog__filter-actions">
          {filters.category ? (
            <ButtonLink
              href={buildBlogListingHref({ ...filters, category: "" }, 1)}
              size="small"
              variant="subtle"
            >
              Clear category filter
            </ButtonLink>
          ) : null}
          {filters.tag ? (
            <ButtonLink
              href={buildBlogListingHref({ ...filters, tag: "" }, 1)}
              size="small"
              variant="subtle"
            >
              Clear tag filter
            </ButtonLink>
          ) : null}
          <ButtonLink href="/blog" size="small" variant="subtle">Clear all filters</ButtonLink>
        </div>
      ) : null}
    </div>
  );
}

function BlogPagination({
  filters,
  page,
  totalPages,
}: {
  filters: BlogListingFilters;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Blog pages" className="public-blog__pagination">
      {page > 1 ? (
        <ButtonLink href={buildBlogListingHref(filters, page - 1)} size="small" variant="secondary">
          Previous
        </ButtonLink>
      ) : (
        <span aria-disabled="true" className="button button--secondary button--small">Previous</span>
      )}
      <span aria-current="page" className="public-blog__page-indicator">Page {page} of {totalPages}</span>
      {page < totalPages ? (
        <ButtonLink href={buildBlogListingHref(filters, page + 1)} size="small" variant="secondary">
          Next
        </ButtonLink>
      ) : (
        <span aria-disabled="true" className="button button--secondary button--small">Next</span>
      )}
    </nav>
  );
}

function hasBlogFilters(filters: BlogListingFilters): boolean {
  return Boolean(filters.search || filters.category || filters.tag);
}

function formatPublicationDate(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function BlogPageLoading() {
  return (
    <section aria-busy="true" className="section page-content">
      <Container>
        <p className="eyebrow" role="status">Loading published articles…</p>
      </Container>
    </section>
  );
}
