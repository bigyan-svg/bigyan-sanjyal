import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  buildBlogListingHref,
  buildPublishedBlogListingQuery,
  buildPublishedBlogPostWhere,
  normalizeBlogListingParams,
  getPublishedBlogArticleMetadata,
  publishedBlogArticleQuery,
  publishedBlogCategoriesQuery,
  publishedBlogPostQuery,
  publishedBlogTagsQuery,
  PUBLIC_BLOG_PAGE_SIZE,
  readPublicBlogListing,
  readPublishedBlogPostBySlug,
  readPublishedBlogPosts,
  splitBlogBodyIntoParagraphs,
  type PublicBlogArticle,
  type PublicBlogListingReader,
  type PublicBlogPost,
} from "../src/lib/public-blog-query";

function makePost(
  id: string,
  title: string,
  publishedAt: Date | null,
  options: { category?: string; tags?: Array<{ id: string; name: string }> } = {},
): PublicBlogPost {
  return {
    id,
    title,
    slug: title.toLocaleLowerCase().replaceAll(" ", "-"),
    excerpt: `${title} excerpt`,
    publishedAt,
    category: options.category ? { name: options.category } : null,
    tags: (options.tags ?? []).map((tag) => ({ tag })),
  };
}

function makeArticle(overrides: Partial<PublicBlogArticle> = {}): PublicBlogArticle {
  return {
    title: "Published Article",
    slug: "published-article",
    excerpt: "A confirmed excerpt.",
    body: "First paragraph.\n\nSecond paragraph.",
    publishedAt: new Date("2026-10-30T12:00:00.000Z"),
    category: { name: "Engineering" },
    tags: [{ tag: { id: "tag-id", name: "TypeScript" } }],
    ...overrides,
  };
}

function makeListingReader(
  overrides: Partial<PublicBlogListingReader> = {},
): PublicBlogListingReader {
  return {
    findPosts: async () => [],
    countPosts: async () => 0,
    findCategories: async () => [],
    findTags: async () => [],
    ...overrides,
  };
}

test("queries only published posts with valid dates in stable newest-first order", async () => {
  const sameDate = new Date("2026-10-30T12:00:00.000Z");
  const candidates = [
    { status: "DRAFT", post: makePost("draft", "Draft", sameDate) },
    { status: "ARCHIVED", post: makePost("archived", "Archived", sameDate) },
    { status: "PUBLISHED", post: makePost("old", "Old", new Date("2026-10-29T12:00:00.000Z")) },
    { status: "PUBLISHED", post: makePost("new-a", "New A", sameDate) },
    { status: "PUBLISHED", post: makePost("new-z", "New Z", sameDate) },
    { status: "PUBLISHED", post: makePost("invalid-date", "Invalid date", null) },
  ];
  let query: typeof publishedBlogPostQuery | undefined;

  const result = await readPublishedBlogPosts(async (args) => {
    query = args;
    return candidates
      .filter(({ status }) => status === args.where.status)
      .map(({ post }) => post)
      .sort((first, second) => {
        const dateDifference =
          (second.publishedAt?.getTime() ?? 0) - (first.publishedAt?.getTime() ?? 0);
        return dateDifference || second.id.localeCompare(first.id);
      });
  });

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;

  assert.deepEqual(result.posts.map(({ id }) => id), ["new-z", "new-a", "old"]);
  assert.equal(query?.where.status, "PUBLISHED");
  assert.deepEqual(query?.where.publishedAt, { not: null });
  assert.deepEqual(query?.orderBy, [{ publishedAt: "desc" }, { id: "desc" }]);
});

test("selects listing fields and category/tag labels without loading the body", async () => {
  let query: typeof publishedBlogPostQuery | undefined;

  const result = await readPublishedBlogPosts(async (args) => {
    query = args;
    return [makePost("published", "Published", new Date("2026-10-30T12:00:00.000Z"), {
      category: "Engineering",
      tags: [{ id: "tag-id", name: "TypeScript" }],
    })];
  });

  assert.equal(result.kind, "success");
  assert.deepEqual(query?.select.category, { select: { name: true } });
  assert.deepEqual(query?.select.tags.select.tag.select, { id: true, name: true });
  assert.equal("body" in (query?.select ?? {}), false);
  assert.equal("status" in (query?.select ?? {}), false);
});

test("returns an empty published list safely", async () => {
  const result = await readPublishedBlogPosts(async () => []);

  assert.deepEqual(result, { kind: "success", posts: [] });
});

test("returns a safe unavailable result without exposing database errors", async () => {
  const result = await readPublishedBlogPosts(async () => {
    throw new Error("Database connection details must not be returned");
  });

  assert.deepEqual(result, { kind: "unavailable" });
});

test("looks up a published article by slug with only public detail fields", async () => {
  let query: ReturnType<typeof publishedBlogArticleQuery> | undefined;
  const post = makeArticle();

  const result = await readPublishedBlogPostBySlug("published-article", async (args) => {
    query = args;
    return post;
  });

  assert.deepEqual(result, { kind: "success", post });
  assert.deepEqual(query?.where, {
    slug: "published-article",
    status: "PUBLISHED",
    publishedAt: { not: null },
  });
  assert.equal(query?.select.title, true);
  assert.equal(query?.select.excerpt, true);
  assert.equal(query?.select.body, true);
  assert.deepEqual(query?.select.category, { select: { name: true } });
  assert.deepEqual(query?.select.tags.select.tag.select, { id: true, name: true });
  assert.equal("status" in (query?.select ?? {}), false);
});

test("draft and archived articles are unavailable to the published-only lookup", async () => {
  const post = makeArticle();

  for (const status of ["DRAFT", "ARCHIVED"]) {
    const result = await readPublishedBlogPostBySlug(post.slug, async (query) => {
      assert.equal(query.where.status, "PUBLISHED");
      return status === query.where.status ? post : null;
    });

    assert.deepEqual(result, { kind: "not-found" });
  }
});

test("a missing article and an invalid slug return not-found results", async () => {
  let readCount = 0;
  const missing = await readPublishedBlogPostBySlug("missing-article", async () => {
    readCount += 1;
    return null;
  });
  const invalidSlug = await readPublishedBlogPostBySlug("Not A Slug", async () => {
    readCount += 1;
    return null;
  });

  assert.deepEqual(missing, { kind: "not-found" });
  assert.deepEqual(invalidSlug, { kind: "not-found" });
  assert.equal(readCount, 1);
});

test("missing and invalid publication dates make an article unavailable", async () => {
  const noDate = { ...makeArticle(), publishedAt: null } as unknown as PublicBlogArticle;
  const invalidDate = { ...makeArticle(), publishedAt: new Date(Number.NaN) };

  const missingDateResult = await readPublishedBlogPostBySlug("published-article", async (query) => {
    assert.deepEqual(query.where.publishedAt, { not: null });
    return noDate;
  });
  const invalidDateResult = await readPublishedBlogPostBySlug("published-article", async () => invalidDate);

  assert.deepEqual(missingDateResult, { kind: "not-found" });
  assert.deepEqual(invalidDateResult, { kind: "not-found" });
});

test("metadata is produced only for a successfully loaded published article", async () => {
  const published = await readPublishedBlogPostBySlug("published-article", async () => makeArticle());
  const missing = await readPublishedBlogPostBySlug("draft-article", async () => null);

  assert.deepEqual(getPublishedBlogArticleMetadata(published), {
    title: "Published Article",
    description: "A confirmed excerpt.",
  });
  assert.equal(getPublishedBlogArticleMetadata(missing), null);
  assert.equal(getPublishedBlogArticleMetadata({ kind: "unavailable" }), null);
});

test("article body paragraphs render as escaped plain text", () => {
  const paragraphs = splitBlogBodyIntoParagraphs(
    "<script>alert('not executable')</script>\n\nA second <em>plain-text</em> paragraph.",
  );
  const renderer = [
    "import { createElement } from 'react';",
    "import { renderToStaticMarkup } from 'react-dom/server';",
    `const paragraphs = ${JSON.stringify(paragraphs)};`,
    "console.log(renderToStaticMarkup(createElement('article', null, ...paragraphs.map((paragraph, index) => createElement('p', { key: index }, paragraph)))));",
  ].join("\n");
  const markup = execFileSync(process.execPath, ["--input-type=module", "--eval", renderer], {
    encoding: "utf8",
  });

  assert.equal(paragraphs.length, 2);
  assert.match(markup, /&lt;script&gt;/u);
  assert.match(markup, /&lt;em&gt;plain-text&lt;\/em&gt;/u);
  assert.doesNotMatch(markup, /<script>|<em>/u);
});

test("search matches title or excerpt and stays within the published-post query", () => {
  const where = buildPublishedBlogPostWhere({ search: "react", category: "", tag: "" });

  assert.deepEqual(where, {
    status: "PUBLISHED",
    publishedAt: { not: null },
    OR: [
      { title: { contains: "react", mode: "insensitive" } },
      { excerpt: { contains: "react", mode: "insensitive" } },
    ],
  });
});

test("category and tag filters each constrain published posts by their taxonomy slug", () => {
  assert.deepEqual(buildPublishedBlogPostWhere({
    search: "",
    category: "engineering",
    tag: "",
  }), {
    status: "PUBLISHED",
    publishedAt: { not: null },
    category: { is: { slug: "engineering" } },
  });
  assert.deepEqual(buildPublishedBlogPostWhere({
    search: "",
    category: "",
    tag: "typescript",
  }), {
    status: "PUBLISHED",
    publishedAt: { not: null },
    tags: { some: { tag: { is: { slug: "typescript" } } } },
  });
});

test("search, category, and tag filters combine with AND semantics", () => {
  assert.deepEqual(buildPublishedBlogPostWhere({
    search: "react",
    category: "engineering",
    tag: "typescript",
  }), {
    status: "PUBLISHED",
    publishedAt: { not: null },
    OR: [
      { title: { contains: "react", mode: "insensitive" } },
      { excerpt: { contains: "react", mode: "insensitive" } },
    ],
    category: { is: { slug: "engineering" } },
    tags: { some: { tag: { is: { slug: "typescript" } } } },
  });
});

test("normalizes and validates search, category, tag, and page parameters", () => {
  assert.deepEqual(normalizeBlogListingParams({
    q: "  React\u0000   Notes  ",
    category: " Engineering ",
    tag: "TypeScript",
    page: "03",
    unused: "ignored",
  }), {
    search: "React Notes",
    category: "engineering",
    tag: "typescript",
    page: 3,
  });

  assert.deepEqual(normalizeBlogListingParams({
    q: Array.from({ length: 120 }, () => "x").join(""),
    category: "../private",
    tag: ["first", "second"],
    page: "0",
  }), {
    search: "x".repeat(100),
    category: "",
    tag: "",
    page: 1,
  });
});

test("category and tag choices come only from published posts with publication dates", () => {
  assert.deepEqual(publishedBlogCategoriesQuery.where, {
    posts: { some: { status: "PUBLISHED", publishedAt: { not: null } } },
  });
  assert.deepEqual(publishedBlogTagsQuery.where, {
    posts: { some: { post: { is: { status: "PUBLISHED", publishedAt: { not: null } } } } },
  });
  assert.deepEqual(publishedBlogCategoriesQuery.select, { name: true, slug: true });
  assert.deepEqual(publishedBlogTagsQuery.select, { name: true, slug: true });
});

test("server-side listing requests one page with the selected published-only filters", async () => {
  const captured: { query?: ReturnType<typeof buildPublishedBlogListingQuery>; countWhere?: unknown } = {};
  const category = { name: "Engineering", slug: "engineering" };
  const tag = { name: "TypeScript", slug: "typescript" };
  const filters = { search: "react", category: category.slug, tag: tag.slug };
  const result = await readPublicBlogListing({
    q: "react",
    category: category.slug,
    tag: tag.slug,
    page: "2",
  }, makeListingReader({
    findCategories: async () => [category],
    findTags: async () => [tag],
    countPosts: async (where) => {
      captured.countWhere = where;
      return 14;
    },
    findPosts: async (query) => {
      captured.query = query;
      return [makePost("page-two", "React notes", new Date("2026-10-30T12:00:00.000Z"))];
    },
  }));

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(result.filters, filters);
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.totalCount, 14);
  assert.deepEqual(captured.countWhere, buildPublishedBlogPostWhere(filters));
  assert.deepEqual(captured.query?.where, captured.countWhere);
  assert.equal(captured.query?.take, PUBLIC_BLOG_PAGE_SIZE);
  assert.equal(captured.query?.skip, PUBLIC_BLOG_PAGE_SIZE);
});

test("pagination clamps out-of-range pages to the last page and uses page boundaries", async () => {
  let query: ReturnType<typeof buildPublishedBlogListingQuery> | undefined;
  const result = await readPublicBlogListing({ page: "999" }, makeListingReader({
    countPosts: async () => 10,
    findPosts: async (args) => {
      query = args;
      return [];
    },
  }));

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(query?.skip, 9);
  assert.equal(query?.take, 9);

  const boundary = buildPublishedBlogListingQuery(
    { search: "", category: "", tag: "" },
    3,
  );
  assert.equal(boundary.skip, 18);
  assert.equal(boundary.take, 9);
});

test("pagination hrefs preserve search, category, and tag filters", () => {
  assert.equal(
    buildBlogListingHref({
      search: "react notes",
      category: "engineering",
      tag: "typescript",
    }, 2),
    "/blog?q=react+notes&category=engineering&tag=typescript&page=2",
  );
  assert.equal(buildBlogListingHref({ search: "", category: "", tag: "" }, 1), "/blog");
});

test("empty search results are returned safely without fetching a post page", async () => {
  let postQueryCount = 0;
  const result = await readPublicBlogListing({ q: "no matches" }, makeListingReader({
    countPosts: async () => 0,
    findPosts: async () => {
      postQueryCount += 1;
      return [];
    },
  }));

  assert.deepEqual(result.kind, "success");
  if (result.kind !== "success") return;
  assert.equal(result.totalCount, 0);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.posts, []);
  assert.equal(postQueryCount, 0);
});

test("listing database failures return a safe unavailable result", async () => {
  const result = await readPublicBlogListing({}, makeListingReader({
    findCategories: async () => {
      throw new Error("Internal database details must not escape");
    },
  }));

  assert.deepEqual(result, { kind: "unavailable" });
});

test("unavailable taxonomy slugs are discarded before building the post query", async () => {
  let countWhere: unknown;
  const result = await readPublicBlogListing({ category: "not-published", tag: "not-published" }, makeListingReader({
    countPosts: async (where) => { countWhere = where; return 0; },
  }));

  assert.equal(result.kind, "success");
  if (result.kind !== "success") return;
  assert.deepEqual(result.filters, { search: "", category: "", tag: "" });
  assert.deepEqual(countWhere, {
    status: "PUBLISHED",
    publishedAt: { not: null },
  });
});
