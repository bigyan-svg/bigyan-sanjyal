import assert from "node:assert/strict";
import test from "node:test";
import {
  BlogTagsMissingError,
  BlogCategoryMissingError,
  ensureBlogCategoryExists,
  getBlogPostPrismaErrorCode,
  isDuplicateBlogPostSlugError,
  replaceBlogPostTags,
} from "../src/lib/blog-content";
import {
  createBlogPostSlug,
  parseCreateBlogPost,
  parseUpdateBlogPost,
  resolveBlogPostPublishedAt,
} from "../src/lib/blog-validation";

const CATEGORY_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51a";
const TAG_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51b";

function validCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "A Useful Post",
    slug: "a-useful-post",
    excerpt: "A short introduction.",
    body: "Plain text content.\nSecond paragraph.",
    categoryId: CATEGORY_ID,
    tagIds: [TAG_ID],
    status: "DRAFT",
    ...overrides,
  };
}

test("suggests normalized URL-friendly post slugs", () => {
  assert.equal(createBlogPostSlug("  Café Notes: First Steps! "), "cafe-notes-first-steps");
  assert.equal(createBlogPostSlug("---"), "");
});

test("validates required fields, status, slug format, and strict allowlists", () => {
  assert.ok(parseCreateBlogPost(validCreateInput()).data);
  assert.equal(parseCreateBlogPost({ ...validCreateInput(), slug: "Bad Slug" }).errors.slug !== undefined, true);
  assert.equal(parseCreateBlogPost({ ...validCreateInput(), status: "VISIBLE" }).errors.status !== undefined, true);
  assert.equal(parseCreateBlogPost({ ...validCreateInput(), extra: true }).invalidShape, true);
  assert.equal(parseCreateBlogPost({ ...validCreateInput(), body: "\n  " }).errors.body !== undefined, true);
});

test("rejects malformed or duplicate category and tag identifiers", () => {
  assert.equal(parseCreateBlogPost(validCreateInput({ categoryId: "not-a-uuid" })).errors.categoryId !== undefined, true);
  assert.equal(parseCreateBlogPost(validCreateInput({ tagIds: ["not-a-uuid"] })).errors.tagIds !== undefined, true);
  assert.equal(parseCreateBlogPost(validCreateInput({ tagIds: [TAG_ID, TAG_ID] })).errors.tagIds !== undefined, true);
});

test("PATCH omission preserves category and tag associations", () => {
  const parsed = parseUpdateBlogPost({ title: "Updated title" });
  assert.deepEqual(parsed.data, { title: "Updated title" });
  assert.equal(parseUpdateBlogPost({}).invalidShape, true);
});

test("publication transitions set a first date and preserve publication history", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const firstPublishedAt = new Date("2025-04-03T10:00:00.000Z");

  assert.equal(resolveBlogPostPublishedAt(null, "DRAFT", now), null);
  assert.equal(resolveBlogPostPublishedAt(null, "PUBLISHED", now), now);
  assert.equal(resolveBlogPostPublishedAt(firstPublishedAt, "PUBLISHED", now), firstPublishedAt);
  assert.equal(resolveBlogPostPublishedAt(firstPublishedAt, "ARCHIVED", now), firstPublishedAt);
  assert.equal(resolveBlogPostPublishedAt(firstPublishedAt, "DRAFT", now), firstPublishedAt);
});

test("recognizes duplicate slug conflicts without exposing Prisma details", () => {
  assert.equal(getBlogPostPrismaErrorCode({ code: "P2002" }), "P2002");
  assert.equal(isDuplicateBlogPostSlugError({ code: "P2002" }), true);
  assert.equal(isDuplicateBlogPostSlugError({ code: "P2025" }), false);
  assert.equal(getBlogPostPrismaErrorCode(new Error("unknown")), null);
});

test("rejects a category UUID that does not exist", async () => {
  const transaction = {
    postCategory: { findUnique: async () => null },
  } as never;
  await assert.rejects(ensureBlogCategoryExists(transaction, CATEGORY_ID), BlogCategoryMissingError);
});

test("replaces tag associations only after validating all selected tags", async () => {
  const calls: string[] = [];
  const transaction = {
    tag: {
      findMany: async () => {
        calls.push("validate");
        return [{ id: TAG_ID }];
      },
    },
    postTag: {
      deleteMany: async () => { calls.push("delete"); },
      createMany: async () => { calls.push("create"); },
    },
  } as never;

  await replaceBlogPostTags(transaction, "post-id", [TAG_ID]);
  assert.deepEqual(calls, ["validate", "delete", "create"]);

  const invalidTransaction = {
    tag: { findMany: async () => [] },
    postTag: {
      deleteMany: async () => { throw new Error("must not delete before validation"); },
      createMany: async () => undefined,
    },
  } as never;
  await assert.rejects(
    replaceBlogPostTags(invalidTransaction, "post-id", [TAG_ID]),
    BlogTagsMissingError,
  );
});
