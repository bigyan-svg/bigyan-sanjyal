import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isAdminBlogPostResponse, saveBlogPostRecord } from "../src/lib/blog-form";
import { canDismissBlogEditor, createBlogOperationCoordinator } from "../src/lib/blog-operation-coordinator";
import type { AdminBlogPostItem } from "../src/lib/blog-types";
import { parseCreateBlogPost } from "../src/lib/blog-validation";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const TAG_ID = "33333333-3333-4333-8333-333333333333";
const TIMESTAMP = "2026-11-02T12:00:00.000Z";

function validPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: POST_ID,
    version: 2,
    title: "A complete post",
    slug: "a-complete-post",
    excerpt: null,
    body: "Plain text body",
    status: "PUBLISHED",
    publishedAt: TIMESTAMP,
    categoryId: CATEGORY_ID,
    category: { id: CATEGORY_ID, name: "Engineering" },
    tags: [{ id: TAG_ID, name: "TypeScript" }],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

test("Blog save accepts the complete API Post contract, including nullable fields and empty relations", () => {
  assert.equal(isAdminBlogPostResponse({ post: validPost() }), true);
  assert.equal(isAdminBlogPostResponse({
    post: validPost({ status: "DRAFT", categoryId: null, category: null, tags: [], excerpt: null, publishedAt: null }),
  }), true);
  assert.equal(isAdminBlogPostResponse({ post: validPost({ title: "😀".repeat(200) }) }), true);
});

test("Post response publication date and slug follow the server's exact invariants", () => {
  assert.equal(isAdminBlogPostResponse({ post: validPost({ status: "PUBLISHED", publishedAt: null }) }), false);
  assert.equal(isAdminBlogPostResponse({ post: validPost({ status: "PUBLISHED", publishedAt: TIMESTAMP }) }), true);
  assert.equal(isAdminBlogPostResponse({ post: validPost({ status: "DRAFT", publishedAt: null }) }), true);
  assert.equal(isAdminBlogPostResponse({ post: validPost({ status: "ARCHIVED", publishedAt: null }) }), true);
  assert.equal(isAdminBlogPostResponse({ post: validPost({ status: "ARCHIVED", publishedAt: TIMESTAMP }) }), true);

  for (const slug of ["Uppercase", "with whitespace", "trailing-", "-leading", "double--hyphen"]) {
    assert.equal(isAdminBlogPostResponse({ post: validPost({ slug }) }), false);
    assert.equal(parseCreateBlogPost({ title: "Post", slug, body: "Body", status: "DRAFT" }).data, null);
  }
  for (const slug of ["valid-slug", "post-2", "a"]) {
    assert.equal(isAdminBlogPostResponse({ post: validPost({ slug }) }), true);
    assert.equal(parseCreateBlogPost({ title: "Post", slug, body: "Body", status: "DRAFT" }).data?.slug, slug);
  }
});

test("Blog save rejects partial and malformed Post responses before they can be adopted", async () => {
  const malformedPosts = [
    { id: POST_ID, version: 2 },
    validPost({ title: undefined }),
    validPost({ body: undefined }),
    validPost({ createdAt: undefined }),
    validPost({ excerpt: 4 }),
    validPost({ categoryId: "invalid" }),
    validPost({ category: undefined }),
    validPost({ tags: undefined }),
    validPost({ updatedAt: "not a timestamp" }),
    validPost({ publishedAt: "2026-02-31T12:00:00.000Z" }),
    validPost({ status: "PRIVATE" }),
    validPost({ tags: {} }),
    validPost({ tags: [{ id: TAG_ID }] }),
    validPost({ category: { id: "invalid", name: "Engineering" } }),
    validPost({ category: { id: TAG_ID, name: "Wrong relation" } }),
    validPost({ category: null }),
    validPost({ tags: [{ id: TAG_ID, name: "TypeScript" }, { id: TAG_ID, name: "Duplicate" }] }),
  ];

  for (const post of malformedPosts) {
    assert.equal(isAdminBlogPostResponse({ post }), false);
  }

  const cached: AdminBlogPostItem[] = [validPost() as unknown as AdminBlogPostItem];
  const originalCache = structuredClone(cached);
  const input = { title: "Submitted title", body: "Submitted body" };
  const result = await saveBlogPostRecord(null, input, async () =>
    new Response(JSON.stringify({ post: { id: POST_ID, version: 1 } }), { status: 201 }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /reload the page/u);
  assert.deepEqual(cached, originalCache);
  assert.deepEqual(input, { title: "Submitted title", body: "Submitted body" });
});

test("Blog manager rejects an invalid save response before cache, editor, or success updates", async () => {
  const source = await readFile(new URL("../src/app/admin/blog/blog-manager.tsx", import.meta.url), "utf8");
  const saveResponse = source.indexOf("const saved = await saveBlogPostRecord");
  const failureBranch = source.indexOf("if (!saved.ok)", saveResponse);
  const failureReturn = source.indexOf("return false;", failureBranch);
  const cacheUpdate = source.indexOf("replacePosts([savedPost", failureReturn);
  const successFeedback = source.indexOf("setPageSuccess(submittedEditor.post", cacheUpdate);
  const editorClose = source.indexOf("setEditor((current) => current?.instanceId === submittedEditor.instanceId ? null : current)", successFeedback);

  assert.ok(saveResponse >= 0);
  assert.ok(failureBranch > saveResponse);
  assert.ok(failureReturn > failureBranch);
  assert.ok(cacheUpdate > failureReturn);
  assert.ok(successFeedback > cacheUpdate);
  assert.ok(editorClose > successFeedback);
});

test("Blog PATCH rejects a complete response for a different Post ID", async () => {
  const otherPostId = "44444444-4444-4444-8444-444444444444";
  const responsePost = validPost({ id: otherPostId });
  assert.equal(isAdminBlogPostResponse({ post: responsePost }), true);

  const result = await saveBlogPostRecord(
    { id: POST_ID, version: 7 },
    { body: "Edited body" },
    async () => new Response(JSON.stringify({ post: responsePost }), { status: 200 }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /did not match the post you edited/u);
});

test("Blog close policy rejects pending operations and allows close after completion", async () => {
  const coordinator = createBlogOperationCoordinator();
  let releaseOperation!: () => void;
  let confirmationCount = 0;
  const operation = coordinator.run("post", () => new Promise<void>((resolve) => { releaseOperation = resolve; }));

  assert.equal(canDismissBlogEditor(coordinator.isBusy(), () => { confirmationCount += 1; return true; }), false);
  assert.equal(confirmationCount, 0, "discard confirmation is not requested while a mutation is pending");
  releaseOperation();
  await operation;
  assert.equal(canDismissBlogEditor(coordinator.isBusy(), () => { confirmationCount += 1; return true; }), true);
  assert.equal(confirmationCount, 1);
});

test("Blog manager guards close callbacks and closes only the initiating editor after save lock release", async () => {
  const source = await readFile(new URL("../src/app/admin/blog/blog-manager.tsx", import.meta.url), "utf8");
  const canDismiss = source.indexOf("function canDismissEditor()");
  const openEditor = source.indexOf("function openEditor(", canDismiss);
  const closeEditor = source.indexOf("function closeEditor(", openEditor);
  const closeEditorEnd = source.indexOf("function beginTaxonomyEditing(", closeEditor);
  const savePost = source.indexOf("async function savePost(", closeEditorEnd);
  const coordinatorRun = source.indexOf('await operationCoordinator.run("post"', savePost);
  const runEnd = source.indexOf("if (attempt.started && attempt.value)", coordinatorRun);
  const guardedClose = source.indexOf("setEditor((current) => current?.instanceId === submittedEditor.instanceId ? null : current)", runEnd);

  assert.ok(canDismiss >= 0 && openEditor > canDismiss);
  assert.match(source.slice(canDismiss, openEditor), /canDismissBlogEditor\(operationCoordinator\.isBusy\(\)/u);
  assert.ok(closeEditor > openEditor && closeEditorEnd > closeEditor);
  assert.match(source.slice(closeEditor, closeEditorEnd), /if \(!canDismissEditor\(\)\) return;/u);
  assert.ok(savePost >= 0 && coordinatorRun > savePost);
  assert.ok(runEnd > coordinatorRun && guardedClose > runEnd);
  assert.match(source.slice(runEnd, guardedClose + 120), /submittedEditor\.instanceId/u);
});

test("all Blog Post controls and close actions are disabled while saving", async () => {
  const source = await readFile(new URL("../src/app/admin/blog/blog-manager.tsx", import.meta.url), "utf8");
  const editorStart = source.indexOf("{editor ? (");
  const editorEnd = source.indexOf("{visiblePosts.length === 0 ?", editorStart);
  const form = source.slice(editorStart, editorEnd);
  assert.match(source, /const postFormDisabled = mutationsUnavailable;/u);
  assert.match(form, /<form aria-busy=\{saving\}/u);

  for (const match of form.matchAll(/<(TextInput|TextArea)\b[\s\S]*?\/>/gu)) {
    assert.match(match[0], /disabled=\{postFormDisabled\}/u, `${match[1]} is disabled`);
  }
  for (const match of form.matchAll(/<select\b[\s\S]*?<\/select>/gu)) {
    assert.match(match[0], /disabled=\{postFormDisabled\}/u, "select is disabled");
  }
  for (const match of form.matchAll(/<input\b[\s\S]*?\/>/gu)) {
    assert.match(match[0], /disabled=\{postFormDisabled\}/u, "tag checkbox is disabled");
  }
  for (const match of form.matchAll(/<Button\b[\s\S]*?>/gu)) {
    assert.match(match[0], /disabled=\{postFormDisabled\}/u, "editor action is disabled");
  }
});

test("Blog manager protects the Post editor before taxonomy deletion and refreshes before releasing the shared lock", async () => {
  const taxonomy = await readFile(new URL("../src/app/admin/blog/blog-taxonomy-manager.tsx", import.meta.url), "utf8");
  const manager = await readFile(new URL("../src/app/admin/blog/blog-manager.tsx", import.meta.url), "utf8");
  const deleteHandler = taxonomy.indexOf("async function deleteTaxonomy(");
  const beginEditing = taxonomy.indexOf("if (!onBeginEditing()) return;", deleteHandler);
  const operation = taxonomy.indexOf("await onRunOperation(async () =>", beginEditing);
  const recovery = taxonomy.indexOf("await recoverBlogTaxonomyDelete(", operation);
  const deleteRequest = taxonomy.indexOf("deleteBlogTaxonomy(item.kind, item.id)", recovery);
  const refresh = taxonomy.indexOf("onRefreshAfterDelete(item.kind, deletionConfirmed)", deleteRequest);
  assert.ok(deleteHandler >= 0 && beginEditing > deleteHandler && operation > beginEditing);
  assert.ok(recovery > operation && deleteRequest > recovery && refresh > deleteRequest);

  const refreshFunction = manager.indexOf("async function refreshAfterTaxonomyDelete(");
  const staleFlag = manager.indexOf("setBlogDataNeedsRefresh(true)", refreshFunction);
  const authoritativeLoad = manager.indexOf("await loadAndAdoptAdminBlogData(adoptBlogData)", staleFlag);
  const retryFunction = manager.indexOf("async function retryBlogDataRefresh()", authoritativeLoad);
  assert.ok(refreshFunction >= 0 && staleFlag > refreshFunction);
  assert.ok(authoritativeLoad > staleFlag && retryFunction > authoritativeLoad);
  const retry = manager.slice(retryFunction, manager.indexOf("async function savePost", retryFunction));
  assert.match(retry, /operationCoordinator\.run\("taxonomy"/u);
  assert.match(retry, /if \(refreshed\.ok\) \{\s*setTaxonomyResetKey/u);
  assert.match(manager, /disabled=\{mutationsUnavailable\}/u);
});

test("Blog manager only removes a Post after a successful version-checked delete and releases the operation lock", async () => {
  const source = await readFile(new URL("../src/app/admin/blog/blog-manager.tsx", import.meta.url), "utf8");
  const handler = source.indexOf("async function deletePost(");
  const operation = source.indexOf('await operationCoordinator.run("post"', handler);
  const result = source.indexOf("await deleteBlogPostRecord(post)", operation);
  const failure = source.indexOf("if (!result.ok)", result);
  const earlyReturn = source.indexOf("return;", failure);
  const cacheRemoval = source.indexOf("replacePosts(postsRef.current.filter((item) => item.id !== post.id))", earlyReturn);
  const finallyClause = source.indexOf("} finally {", cacheRemoval);

  assert.ok(handler >= 0 && operation > handler && result > operation);
  assert.ok(failure > result && earlyReturn > failure && cacheRemoval > earlyReturn);
  assert.ok(finallyClause > cacheRemoval);
  assert.match(source.slice(handler, source.indexOf("function toggleTag", handler)), /setDeletingId\(null\)/u);
});
