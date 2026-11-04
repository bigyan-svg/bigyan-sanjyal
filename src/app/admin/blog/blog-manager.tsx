"use client";

import {
  CheckCircle2,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import type { ContentStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import { createBlogPostSlug, type BlogPostFieldErrors } from "@/lib/blog-validation";
import {
  getBlogPostEditorRelations,
  syncBlogPostCategoryLabel,
  syncBlogPostTagLabel,
  upsertAdminBlogCategory,
  upsertAdminBlogTag,
} from "@/lib/blog-taxonomy-state";
import { BlogTaxonomyManager } from "./blog-taxonomy-manager";
import type {
  AdminBlogCategory,
  AdminBlogPostItem,
  AdminBlogTag,
} from "@/lib/blog-types";
import { deleteBlogPostRecord, saveBlogPostRecord } from "@/lib/blog-form";
import { loadAndAdoptAdminBlogData } from "@/lib/blog-admin-client";
import { canDismissBlogEditor, createBlogOperationCoordinator, type BlogOperationRunResult } from "@/lib/blog-operation-coordinator";
import { useAdminUnsavedNavigationProtection } from "@/components/admin/admin-unsaved-navigation-guard";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";

type StatusFilter = "ALL" | ContentStatus;

interface BlogPostFormValues {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  categoryId: string;
  tagIds: string[];
  status: ContentStatus;
}

interface BlogEditor {
  instanceId: number;
  post: AdminBlogPostItem | null;
  initialValues: BlogPostFormValues;
  values: BlogPostFormValues;
  slugManuallyEdited: boolean;
}

function toFormValues(post: AdminBlogPostItem | null): BlogPostFormValues {
  const relations = getBlogPostEditorRelations(post);
  return {
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    body: post?.body ?? "",
    categoryId: relations.categoryId,
    tagIds: relations.tagIds,
    status: post?.status ?? "DRAFT",
  };
}

function makeEditor(post: AdminBlogPostItem | null, instanceId: number): BlogEditor {
  const values = toFormValues(post);
  return { instanceId, post, initialValues: values, values, slugManuallyEdited: false };
}

function statusLabel(status: ContentStatus): string {
  switch (status) {
    case "PUBLISHED": return "Published";
    case "ARCHIVED": return "Archived";
    default: return "Draft";
  }
}

export function BlogManager({
  initialCategories,
  initialPosts,
  initialTags,
}: {
  initialCategories: AdminBlogCategory[];
  initialPosts: AdminBlogPostItem[];
  initialTags: AdminBlogTag[];
}) {
  const [posts, setPosts] = useState(initialPosts);
  const postsRef = useRef(initialPosts);
  const [categories, setCategories] = useState<AdminBlogCategory[]>(initialCategories);
  const [tags, setTags] = useState<AdminBlogTag[]>(initialTags);
  const [editor, setEditor] = useState<BlogEditor | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [pendingDelete, setPendingDelete] = useState<AdminBlogPostItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const [blogDataNeedsRefresh, setBlogDataNeedsRefresh] = useState(false);
  const [blogRefreshMessage, setBlogRefreshMessage] = useState("");
  const [refreshingBlogData, setRefreshingBlogData] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<BlogPostFieldErrors>({});
  const [activeOperation, setActiveOperation] = useState<"post" | "taxonomy" | null>(null);
  const [operationCoordinator] = useState(() => createBlogOperationCoordinator(setActiveOperation));
  const editorInstanceCounterRef = useRef(0);
  const [taxonomyIsDirty, setTaxonomyIsDirty] = useState(false);
  const [taxonomyResetKey, setTaxonomyResetKey] = useState(0);

  const operationPending = activeOperation !== null;
  const mutationsUnavailable = operationPending || blogDataNeedsRefresh;
  const postFormDisabled = mutationsUnavailable;
  const editorIsDirty = Boolean(editor && hasUnsavedChanges(editor.initialValues, editor.values));
  const hasUnsavedChangesInPage = editorIsDirty || taxonomyIsDirty;
  useAdminUnsavedNavigationProtection(hasUnsavedChangesInPage, operationPending);

  const reportTaxonomyDirty = useCallback((isDirty: boolean) => {
    setTaxonomyIsDirty(isDirty);
  }, []);

  const visiblePosts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return posts.filter((post) => {
      const matchesSearch = !normalizedSearch || post.title.toLocaleLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "ALL" || post.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [posts, search, statusFilter]);

  function canDismissEditor(): boolean {
    return canDismissBlogEditor(operationCoordinator.isBusy(), () =>
      confirmDiscardIfDirty(hasUnsavedChangesInPage),
    );
  }

  function openEditor(post: AdminBlogPostItem | null) {
    if (blogDataNeedsRefresh) return;
    if (!canDismissEditor()) return;
    setTaxonomyIsDirty(false);
    setTaxonomyResetKey((key) => key + 1);
    setEditor(makeEditor(post, ++editorInstanceCounterRef.current));
    setPendingDelete(null);
    setFieldErrors({});
    setPageError("");
    setPageSuccess("");
  }

  function closeEditor() {
    if (!canDismissEditor()) return;
    setEditor(null);
    setFieldErrors({});
  }

  function beginTaxonomyEditing(): boolean {
    if (operationCoordinator.isBusy()) return false;
    if (!confirmDiscardIfDirty(editorIsDirty)) return false;
    setEditor(null);
    setFieldErrors({});
    return true;
  }

  function replacePosts(nextPosts: AdminBlogPostItem[]) {
    postsRef.current = nextPosts;
    setPosts(nextPosts);
    setCategories((current) => current.map((category) => ({
      ...category,
      postCount: nextPosts.filter((post) => post.categoryId === category.id).length,
    })));
    setTags((current) => current.map((tag) => ({
      ...tag,
      postCount: nextPosts.filter((post) => post.tags.some(({ id }) => id === tag.id)).length,
    })));
  }

  function saveCategory(category: AdminBlogCategory) {
    setCategories((current) => upsertAdminBlogCategory(current, category));
    const nextPosts = syncBlogPostCategoryLabel(postsRef.current, category);
    postsRef.current = nextPosts;
    setPosts(nextPosts);
  }

  function saveTag(tag: AdminBlogTag) {
    setTags((current) => upsertAdminBlogTag(current, tag));
    const nextPosts = syncBlogPostTagLabel(postsRef.current, tag);
    postsRef.current = nextPosts;
    setPosts(nextPosts);
  }

  function adoptBlogData(data: { posts: AdminBlogPostItem[]; categories: AdminBlogCategory[]; tags: AdminBlogTag[] }) {
    postsRef.current = data.posts;
    setPosts(data.posts);
    setCategories(data.categories);
    setTags(data.tags);
    setBlogDataNeedsRefresh(false);
    setBlogRefreshMessage("");
  }

  async function refreshAfterTaxonomyDelete(
    kind: "category" | "tag",
    deletionConfirmed: boolean,
  ): Promise<boolean> {
    setBlogDataNeedsRefresh(true);
    setBlogRefreshMessage("");
    setPageError("");
    setPageSuccess("");

    const refreshed = await loadAndAdoptAdminBlogData(adoptBlogData);
    if (!refreshed.ok) {
      const label = kind === "category" ? "category" : "tag";
      setBlogRefreshMessage(deletionConfirmed
        ? `The ${label} was deleted successfully, but the Blog data could not be refreshed. Retry to load the latest posts, categories, and tags.`
        : `The ${label} deletion response was incomplete, and the Blog data could not be refreshed. Retry to verify its current state.`);
      return false;
    }

    return true;
  }

  async function runTaxonomyOperation<T>(operation: () => Promise<T>): Promise<BlogOperationRunResult<T>> {
    if (blogDataNeedsRefresh) return { started: false };
    return operationCoordinator.run("taxonomy", operation);
  }

  async function retryBlogDataRefresh() {
    if (!blogDataNeedsRefresh || operationCoordinator.isBusy()) return;
    await operationCoordinator.run("taxonomy", async () => {
      setRefreshingBlogData(true);
      try {
        const refreshed = await loadAndAdoptAdminBlogData(adoptBlogData);
        if (refreshed.ok) {
          setTaxonomyResetKey((key) => key + 1);
        }
      } finally {
        setRefreshingBlogData(false);
      }
    });
  }

  function updateValues(update: (values: BlogPostFormValues) => BlogPostFormValues) {
    setEditor((current) => current ? { ...current, values: update(current.values) } : current);
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving || deletingId || blogDataNeedsRefresh) return;
    const submittedEditor = editor;

    const attempt = await operationCoordinator.run("post", async () => {
      setSaving(true);
      setPageError("");
      setPageSuccess("");
      setFieldErrors({});

      try {
        const saved = await saveBlogPostRecord(editor.post, {
          title: submittedEditor.values.title,
          slug: submittedEditor.values.slug,
          excerpt: submittedEditor.values.excerpt,
          body: submittedEditor.values.body,
          categoryId: submittedEditor.values.categoryId || null,
          tagIds: submittedEditor.values.tagIds,
          status: submittedEditor.values.status,
        });
        if (!saved.ok) {
          setPageError(saved.error);
          setFieldErrors(saved.fields);
          return false;
        }

        const savedPost = saved.post;
        replacePosts([savedPost, ...postsRef.current.filter((post) => post.id !== savedPost.id)]);
        setPageSuccess(submittedEditor.post ? "Post updated." : "Post created.");
        return true;
      } catch {
        setPageError("Unable to save the post. Please try again.");
        return false;
      } finally {
        setSaving(false);
      }
    });

    if (attempt.started && attempt.value) {
      setEditor((current) => current?.instanceId === submittedEditor.instanceId ? null : current);
    }
  }

  async function deletePost(post: AdminBlogPostItem) {
    if (deletingId || saving || blogDataNeedsRefresh) return;
    await operationCoordinator.run("post", async () => {
      setDeletingId(post.id);
      setPageError("");
      setPageSuccess("");

      try {
        const result = await deleteBlogPostRecord(post);
        if (!result.ok) {
          setPageError(result.error);
          return;
        }

        replacePosts(postsRef.current.filter((item) => item.id !== post.id));
        if (editor?.post?.id === post.id) setEditor(null);
        setPendingDelete(null);
        setPageSuccess("Post deleted.");
      } catch {
        setPageError("Unable to delete the post. Please try again.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  function toggleTag(tagId: string) {
    updateValues((values) => ({
      ...values,
      tagIds: values.tagIds.includes(tagId)
        ? values.tagIds.filter((id) => id !== tagId)
        : [...values.tagIds, tagId],
    }));
  }

  return (
    <div className="project-management blog-management">
      <section aria-labelledby="blog-management-heading" className="project-management__toolbar">
        <div>
          <p className="eyebrow">Content library</p>
          <h2 id="blog-management-heading">Blog posts</h2>
        <p>Manage plain-text articles and their publication status. The first publication date is kept through Draft and Archive changes and when a post is republished.</p>
        </div>
        <Button disabled={mutationsUnavailable} onClick={() => openEditor(null)}>
          <Plus aria-hidden="true" size={17} />
          Add post
        </Button>
      </section>

      {pageSuccess ? (
        <p className="project-management__feedback project-management__feedback--success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          {pageSuccess}
        </p>
      ) : null}
      {pageError ? (
        <p className="project-management__feedback project-management__feedback--error" role="alert">
          {pageError}
        </p>
      ) : null}
      {blogDataNeedsRefresh ? (
        <Card
          aria-busy={refreshingBlogData || operationPending}
          className="project-management__load-error"
          role={blogRefreshMessage ? "alert" : "status"}
          variant="outlined"
        >
          <h2>Blog data needs to be refreshed</h2>
          <p>{blogRefreshMessage || "Refreshing posts, categories, and tags…"}</p>
          <Button disabled={operationPending || refreshingBlogData} onClick={() => void retryBlogDataRefresh()}>
            {refreshingBlogData ? <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} /> : null}
            {refreshingBlogData ? "Refreshing…" : "Retry refresh"}
          </Button>
        </Card>
      ) : null}

      <BlogTaxonomyManager
        key={taxonomyResetKey}
        categories={categories}
        operationPending={mutationsUnavailable}
        onCanStartOperation={() => !blogDataNeedsRefresh && !operationCoordinator.isBusy()}
        onRunOperation={runTaxonomyOperation}
        onBeginEditing={beginTaxonomyEditing}
        onCategorySaved={saveCategory}
        onDirtyChange={reportTaxonomyDirty}
        onRefreshAfterDelete={refreshAfterTaxonomyDelete}
        onTagSaved={saveTag}
        tags={tags}
      />

      <section aria-label="Search and filter blog posts" className="blog-management__filters">
        <TextInput
          id="blog-search"
          label="Search by title"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search posts"
          type="search"
          value={search}
        />
        <div className="project-management__field">
          <label className="form-field__label" htmlFor="blog-status-filter">Filter by status</label>
          <select
            className="form-control"
            id="blog-status-filter"
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            value={statusFilter}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>
        <p aria-live="polite" className="blog-management__result-count">
          {visiblePosts.length} {visiblePosts.length === 1 ? "post" : "posts"}
        </p>
      </section>

      {editor ? (
        <Card className="project-management__editor" variant="outlined">
          <div className="project-management__editor-heading">
            <div>
              <p className="eyebrow">{editor.post ? "Edit post" : "New post"}</p>
              <h3>{editor.post ? editor.post.title : "Create a blog post"}</h3>
            </div>
            <Button aria-label="Close post editor" disabled={postFormDisabled} onClick={closeEditor} size="small" variant="subtle">
              <X aria-hidden="true" size={16} />
              Close
            </Button>
          </div>

          <form aria-busy={saving} className="project-management__form" onSubmit={(event) => void savePost(event)}>
            <div className="project-management__form-row">
              <TextInput
                disabled={postFormDisabled}
                error={fieldErrors.title}
                id="blog-post-title"
                label="Title"
                maxLength={200}
                onChange={(event) => {
                  const title = event.target.value;
                  setEditor((current) => {
                    if (!current) return current;
                    return {
                      ...current,
                      values: {
                        ...current.values,
                        title,
                        slug: current.slugManuallyEdited ? current.values.slug : createBlogPostSlug(title),
                      },
                    };
                  });
                }}
                required
                value={editor.values.title}
              />
              <TextInput
                disabled={postFormDisabled}
                error={fieldErrors.slug}
                id="blog-post-slug"
                label="Slug"
                maxLength={180}
                onChange={(event) => setEditor((current) => current ? {
                  ...current,
                  values: { ...current.values, slug: event.target.value },
                  slugManuallyEdited: true,
                } : current)}
                required
                value={editor.values.slug}
              />
            </div>

            <TextArea
              disabled={postFormDisabled}
              error={fieldErrors.excerpt}
              id="blog-post-excerpt"
              label="Excerpt"
              maxLength={500}
              onChange={(event) => updateValues((values) => ({ ...values, excerpt: event.target.value }))}
              rows={3}
              value={editor.values.excerpt}
            />
            <TextArea
              className="blog-management__body"
              disabled={postFormDisabled}
              error={fieldErrors.body}
              hint="Plain text only. Formatting and HTML are not interpreted."
              id="blog-post-body"
              label="Body / content"
              maxLength={128_000}
              onChange={(event) => updateValues((values) => ({ ...values, body: event.target.value }))}
              required
              rows={14}
              value={editor.values.body}
            />

            <div className="project-management__form-row blog-management__form-row--options">
              <div className="project-management__field">
                <label className="form-field__label" htmlFor="blog-post-category">Category</label>
                <select
                  className="form-control"
                  disabled={postFormDisabled}
                  id="blog-post-category"
                  onChange={(event) => updateValues((values) => ({ ...values, categoryId: event.target.value }))}
                  value={editor.values.categoryId}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
                {fieldErrors.categoryId ? <span className="project-management__field-error" role="alert">{fieldErrors.categoryId}</span> : null}
              </div>
              <div className="project-management__field">
                <label className="form-field__label" htmlFor="blog-post-status">Publication status</label>
                <select
                  className="form-control"
                  disabled={postFormDisabled}
                  id="blog-post-status"
                  onChange={(event) => updateValues((values) => ({ ...values, status: event.target.value as ContentStatus }))}
                  value={editor.values.status}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                <span className="blog-management__hint">The first publication date is retained through Draft and Archive changes and when republished.</span>
                {fieldErrors.status ? <span className="project-management__field-error" role="alert">{fieldErrors.status}</span> : null}
              </div>
            </div>

            <fieldset className="blog-management__tag-picker">
              <legend>Tags</legend>
              {tags.length === 0 ? (
                <p>No tags are available yet.</p>
              ) : (
                <div className="blog-management__tag-options">
                  {tags.map((tag) => (
                    <label className="blog-management__tag-option" key={tag.id}>
                      <input
                        checked={editor.values.tagIds.includes(tag.id)}
                        disabled={postFormDisabled}
                        onChange={() => toggleTag(tag.id)}
                        type="checkbox"
                      />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {fieldErrors.tagIds ? <span className="project-management__field-error" role="alert">{fieldErrors.tagIds}</span> : null}
            </fieldset>

            <div className="project-management__editor-actions">
              <Button disabled={postFormDisabled} onClick={closeEditor} type="button" variant="subtle">
                <X aria-hidden="true" size={16} />
                Cancel
              </Button>
              <Button disabled={postFormDisabled} type="submit">
                {saving ? (
                  <LoaderCircle aria-hidden="true" className="project-management__spinner" size={16} />
                ) : (
                  <Save aria-hidden="true" size={16} />
                )}
                {saving ? "Saving…" : "Save post"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {visiblePosts.length === 0 ? (
        <Card className="project-management__empty" variant="outlined">
          <FileText aria-hidden="true" size={24} />
          <h3>{posts.length === 0 ? "No blog posts have been added" : "No posts match these filters"}</h3>
          <p>{posts.length === 0 ? "Create a post when you have content ready to enter." : "Try a different title search or status filter."}</p>
          {posts.length === 0 ? (
            <Button disabled={mutationsUnavailable} onClick={() => openEditor(null)}>
              <Plus aria-hidden="true" size={17} />
              Add post
            </Button>
          ) : null}
        </Card>
      ) : (
        <div className="project-management__list">
          {visiblePosts.map((post) => (
            <article aria-labelledby={`blog-post-${post.id}`} className="project-management__item" key={post.id}>
              <div className="project-management__item-heading">
                <h3 id={`blog-post-${post.id}`}>{post.title}</h3>
                <span className={`project-management__status project-management__status--${post.status.toLowerCase()}`}>
                  {statusLabel(post.status)}
                </span>
              </div>
              <p className="project-management__slug">/{post.slug}</p>
              {post.excerpt ? <p className="project-management__summary">{post.excerpt}</p> : null}
              <p className="project-management__meta">
                {post.category?.name ?? "No category"}
                {post.tags.length > 0 ? <span aria-hidden="true"> · </span> : null}
                {post.tags.map(({ name }) => name).join(", ")}
                {post.publishedAt ? <span> · Originally published {new Date(post.publishedAt).toLocaleDateString()}</span> : null}
              </p>

              {pendingDelete?.id === post.id ? (
                <div aria-label={`Confirm deletion of ${post.title}`} className="project-management__delete-confirm" role="group">
                  <div>
                    <strong>Delete this post permanently?</strong>
                    <p>The post and its tag associations will be deleted. This cannot be undone.</p>
                  </div>
                  <div className="project-management__confirm-actions">
                    <Button disabled={mutationsUnavailable} onClick={() => void deletePost(post)} size="small">
                      {deletingId === post.id ? (
                        <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} />
                      ) : (
                        <Trash2 aria-hidden="true" size={15} />
                      )}
                      {deletingId === post.id ? "Deleting…" : "Confirm delete"}
                    </Button>
                    <Button disabled={mutationsUnavailable} onClick={() => setPendingDelete(null)} size="small" variant="subtle">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="project-management__actions">
                  <Button aria-label={`Edit post ${post.title}`} disabled={mutationsUnavailable} onClick={() => openEditor(post)} size="small" variant="subtle">
                    <Pencil aria-hidden="true" size={15} />
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete post ${post.title}`}
                    disabled={mutationsUnavailable}
                    onClick={() => {
                      if (!canDismissEditor()) return;
                      setEditor(null);
                      setPendingDelete(post);
                      setPageError("");
                      setPageSuccess("");
                    }}
                    size="small"
                    variant="subtle"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    Delete
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
