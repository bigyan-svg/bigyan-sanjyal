import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteBlogCategoryWithPosts,
  deleteBlogTagWithAssociations,
  isBlogTaxonomyUniqueConflict,
} from "../src/lib/blog-taxonomy-content";
import {
  getBlogPostEditorRelations,
  removeBlogCategoryFromPosts,
  removeBlogTagFromPosts,
  syncBlogPostCategoryLabel,
  syncBlogPostTagLabel,
  upsertAdminBlogCategory,
  upsertAdminBlogTag,
} from "../src/lib/blog-taxonomy-state";
import {
  createBlogCategorySlug,
  createBlogTagSlug,
  isValidBlogTaxonomyId,
  parseBlogCategoryInput,
  parseBlogTagInput,
} from "../src/lib/blog-taxonomy-validation";

const CATEGORY_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51a";
const TAG_ID = "14dc7308-3d0a-4f0d-8e33-99dafd4bc51b";

test("category validation accepts editable slugs and bounds all category fields", () => {
  const valid = parseBlogCategoryInput({
    name: "  Engineering  ",
    slug: "engineering-notes",
    description: "Notes about building software.",
    sortOrder: 12,
  });
  assert.deepEqual(valid.data, {
    name: "Engineering",
    slug: "engineering-notes",
    description: "Notes about building software.",
    sortOrder: 12,
  });

  assert.equal(parseBlogCategoryInput({ slug: "category", sortOrder: 0 }).errors.name, "Category name is required.");
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "Bad Slug", description: null, sortOrder: 0 }).errors.slug);
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: null, sortOrder: -1 }).errors.sortOrder);
  assert.ok(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: "x".repeat(501), sortOrder: 0 }).errors.description);
  assert.equal(parseBlogCategoryInput({ name: "Engineering", slug: "engineering", description: null, sortOrder: 0, extra: true }).invalidShape, true);
});

test("tag validation accepts valid values and rejects missing names or malformed slugs", () => {
  assert.deepEqual(parseBlogTagInput({ name: "TypeScript", slug: "typescript" }).data, {
    name: "TypeScript",
    slug: "typescript",
  });
  assert.equal(parseBlogTagInput({ name: " ", slug: "typescript" }).errors.name, "Tag name is required.");
  assert.ok(parseBlogTagInput({ name: "TypeScript", slug: "Type Script" }).errors.slug);
  assert.equal(parseBlogTagInput({ name: "TypeScript", slug: "typescript", description: "not allowed" }).invalidShape, true);
});

test("taxonomy slug suggestions share the site's URL-friendly normalization", () => {
  assert.equal(createBlogCategorySlug("Café Notes"), "cafe-notes");
  assert.equal(createBlogTagSlug("Next.js 16"), "next-js-16");
  assert.equal(isValidBlogTaxonomyId(CATEGORY_ID), true);
  assert.equal(isValidBlogTaxonomyId("not-a-uuid"), false);
});

test("unique name and slug constraints become safe conflict responses", () => {
  assert.equal(isBlogTaxonomyUniqueConflict({ code: "P2002" }), true);
  assert.equal(isBlogTaxonomyUniqueConflict({ code: "P2025" }), false);
});

test("category deletion reports affected posts and deletes only the category row", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock-category");
      return [{ id: CATEGORY_ID, name: "Engineering" }];
    },
    post: { count: async () => { calls.push("count-posts"); return 3; } },
    postCategory: { delete: async () => { calls.push("delete-category"); } },
  } as never;

  const result = await deleteBlogCategoryWithPosts(transaction, CATEGORY_ID);
  assert.deepEqual(result, { name: "Engineering", detachedPostCount: 3 });
  assert.deepEqual(calls, ["lock-category", "count-posts", "delete-category"]);
});

test("tag deletion counts and cascades associations without deleting posts", async () => {
  const calls: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      calls.push("lock-tag");
      return [{ id: TAG_ID, name: "TypeScript" }];
    },
    postTag: { count: async () => { calls.push("count-associations"); return 2; } },
    tag: { delete: async () => { calls.push("delete-tag"); } },
  } as never;

  const result = await deleteBlogTagWithAssociations(transaction, TAG_ID);
  assert.deepEqual(result, { name: "TypeScript", removedAssociationCount: 2 });
  assert.deepEqual(calls, ["lock-tag", "count-associations", "delete-tag"]);
});

test("new and edited taxonomy is reflected in the post editor and existing post associations", () => {
  const category = {
    id: CATEGORY_ID,
    name: "Engineering",
    slug: "engineering",
    description: null,
    sortOrder: 0,
    postCount: 1,
  };
  const tag = { id: TAG_ID, name: "TypeScript", slug: "typescript", postCount: 1 };
  const initialPosts = [{
    id: "post-1",
    title: "Typed notes",
    slug: "typed-notes",
    excerpt: null,
    body: "Plain text",
    status: "DRAFT" as const,
    publishedAt: null,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: "2026-10-31T00:00:00.000Z",
    updatedAt: "2026-10-31T00:00:00.000Z",
  }];

  assert.equal(upsertAdminBlogCategory([], category)[0]?.id, CATEGORY_ID);
  assert.equal(upsertAdminBlogTag([], tag)[0]?.id, TAG_ID);
  assert.deepEqual(getBlogPostEditorRelations(initialPosts[0]!), { categoryId: CATEGORY_ID, tagIds: [TAG_ID] });

  const renamedCategory = { ...category, name: "Software" };
  const renamedTag = { ...tag, name: "TS" };
  const renamedPosts = syncBlogPostTagLabel(
    syncBlogPostCategoryLabel(initialPosts, renamedCategory),
    renamedTag,
  );
  assert.equal(renamedPosts[0]?.category?.name, "Software");
  assert.equal(renamedPosts[0]?.tags[0]?.name, "TS");
  assert.equal(renamedPosts[0]?.categoryId, CATEGORY_ID);
  assert.deepEqual(renamedPosts[0]?.tags.map(({ id }) => id), [TAG_ID]);

  const postsAfterDeletion = removeBlogTagFromPosts(
    removeBlogCategoryFromPosts(renamedPosts, CATEGORY_ID),
    TAG_ID,
  );
  assert.equal(postsAfterDeletion[0]?.id, "post-1");
  assert.equal(postsAfterDeletion[0]?.categoryId, null);
  assert.deepEqual(postsAfterDeletion[0]?.tags, []);
});
