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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ContentStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import { createBlogPostSlug, type BlogPostFieldErrors } from "@/lib/blog-validation";
import {
  getBlogPostEditorRelations,
  removeBlogCategoryFromPosts,
  removeBlogTagFromPosts,
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

function makeEditor(post: AdminBlogPostItem | null): BlogEditor {
  const values = toFormValues(post);
  return { post, initialValues: values, values, slugManuallyEdited: false };
}

function statusLabel(status: ContentStatus): string {
  switch (status) {
    case "PUBLISHED": return "Published";
    case "ARCHIVED": return "Archived";
    default: return "Draft";
  }
}

function responseError(result: unknown, fallback: string): string {
  if (typeof result === "object" && result !== null && "error" in result) {
    const error = result.error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function responseFields(result: unknown): BlogPostFieldErrors {
  if (
    typeof result === "object" &&
    result !== null &&
    "fields" in result &&
    typeof result.fields === "object" &&
    result.fields !== null
  ) {
    return result.fields as BlogPostFieldErrors;
  }
  return {};
}

async function readResponse(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
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
  const [fieldErrors, setFieldErrors] = useState<BlogPostFieldErrors>({});
  const [taxonomyIsDirty, setTaxonomyIsDirty] = useState(false);
  const [taxonomyResetKey, setTaxonomyResetKey] = useState(0);

  const editorIsDirty = Boolean(editor && hasUnsavedChanges(editor.initialValues, editor.values));
  const hasUnsavedChangesInPage = editorIsDirty || taxonomyIsDirty;

  const reportTaxonomyDirty = useCallback((isDirty: boolean) => {
    setTaxonomyIsDirty(isDirty);
  }, []);

  useEffect(() => {
    if (!hasUnsavedChangesInPage) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!link || link.getAttribute("target") === "_blank" || link.hasAttribute("download")) return;
      if (!confirmDiscardIfDirty(true)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleNavigation, true);
    };
  }, [hasUnsavedChangesInPage]);

  const visiblePosts = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return posts.filter((post) => {
      const matchesSearch = !normalizedSearch || post.title.toLocaleLowerCase().includes(normalizedSearch);
      const matchesStatus = statusFilter === "ALL" || post.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [posts, search, statusFilter]);

  function canDismissEditor(): boolean {
    return confirmDiscardIfDirty(hasUnsavedChangesInPage);
  }

  function openEditor(post: AdminBlogPostItem | null) {
    if (!canDismissEditor()) return;
    setTaxonomyIsDirty(false);
    setTaxonomyResetKey((key) => key + 1);
    setEditor(makeEditor(post));
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

  function deleteCategory(categoryId: string) {
    setCategories((current) => current.filter((category) => category.id !== categoryId));
    const nextPosts = removeBlogCategoryFromPosts(postsRef.current, categoryId);
    postsRef.current = nextPosts;
    setPosts(nextPosts);
    setEditor((current) => current ? {
      ...current,
      initialValues: {
        ...current.initialValues,
        categoryId: current.initialValues.categoryId === categoryId ? "" : current.initialValues.categoryId,
      },
      values: {
        ...current.values,
        categoryId: current.values.categoryId === categoryId ? "" : current.values.categoryId,
      },
    } : current);
  }

  function saveTag(tag: AdminBlogTag) {
    setTags((current) => upsertAdminBlogTag(current, tag));
    const nextPosts = syncBlogPostTagLabel(postsRef.current, tag);
    postsRef.current = nextPosts;
    setPosts(nextPosts);
  }

  function deleteTag(tagId: string) {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
    const nextPosts = removeBlogTagFromPosts(postsRef.current, tagId);
    postsRef.current = nextPosts;
    setPosts(nextPosts);
    setEditor((current) => current ? {
      ...current,
      initialValues: { ...current.initialValues, tagIds: current.initialValues.tagIds.filter((id) => id !== tagId) },
      values: { ...current.values, tagIds: current.values.tagIds.filter((id) => id !== tagId) },
    } : current);
  }

  function updateValues(update: (values: BlogPostFormValues) => BlogPostFormValues) {
    setEditor((current) => current ? { ...current, values: update(current.values) } : current);
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving || deletingId) return;

    setSaving(true);
    setPageError("");
    setPageSuccess("");
    setFieldErrors({});

    try {
      const response = await fetch(
        editor.post ? `/api/admin/blog/${editor.post.id}` : "/api/admin/blog",
        {
          method: editor.post ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            title: editor.values.title,
            slug: editor.values.slug,
            excerpt: editor.values.excerpt,
            body: editor.values.body,
            categoryId: editor.values.categoryId || null,
            tagIds: editor.values.tagIds,
            status: editor.values.status,
          }),
        },
      );
      const result = await readResponse(response);
      if (!response.ok) {
        setPageError(responseError(result, "Unable to save the post. Please try again."));
        setFieldErrors(responseFields(result));
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("post" in result) ||
        typeof result.post !== "object" ||
        result.post === null
      ) {
        setPageError("The server returned an unexpected response. Please reload the page.");
        return;
      }

      const savedPost = result.post as AdminBlogPostItem;
      replacePosts([savedPost, ...postsRef.current.filter((post) => post.id !== savedPost.id)]);
      setEditor(null);
      setPageSuccess(editor.post ? "Post updated." : "Post created.");
    } catch {
      setPageError("Unable to save the post. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deletePost(post: AdminBlogPostItem) {
    if (deletingId || saving) return;
    setDeletingId(post.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/blog/${post.id}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const result = await readResponse(response);
      if (!response.ok) {
        setPageError(responseError(result, "Unable to delete the post. Please try again."));
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
        <Button disabled={saving || Boolean(deletingId)} onClick={() => openEditor(null)}>
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

      <BlogTaxonomyManager
        key={taxonomyResetKey}
        categories={categories}
        onBeginEditing={beginTaxonomyEditing}
        onCategoryDeleted={deleteCategory}
        onCategorySaved={saveCategory}
        onDirtyChange={reportTaxonomyDirty}
        onTagDeleted={deleteTag}
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
            <Button aria-label="Close post editor" disabled={saving} onClick={closeEditor} size="small" variant="subtle">
              <X aria-hidden="true" size={16} />
              Close
            </Button>
          </div>

          <form className="project-management__form" onSubmit={(event) => void savePost(event)}>
            <div className="project-management__form-row">
              <TextInput
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
              <Button disabled={saving} onClick={closeEditor} type="button" variant="subtle">
                <X aria-hidden="true" size={16} />
                Cancel
              </Button>
              <Button disabled={saving} type="submit">
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
            <Button onClick={() => openEditor(null)}>
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
                    <Button disabled={deletingId === post.id} onClick={() => void deletePost(post)} size="small">
                      {deletingId === post.id ? (
                        <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} />
                      ) : (
                        <Trash2 aria-hidden="true" size={15} />
                      )}
                      {deletingId === post.id ? "Deleting…" : "Confirm delete"}
                    </Button>
                    <Button disabled={deletingId === post.id} onClick={() => setPendingDelete(null)} size="small" variant="subtle">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="project-management__actions">
                  <Button aria-label={`Edit post ${post.title}`} disabled={saving || Boolean(deletingId)} onClick={() => openEditor(post)} size="small" variant="subtle">
                    <Pencil aria-hidden="true" size={15} />
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete post ${post.title}`}
                    disabled={saving || Boolean(deletingId)}
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
