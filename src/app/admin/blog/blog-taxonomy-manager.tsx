"use client";

import { CheckCircle2, FolderPlus, LoaderCircle, Pencil, Plus, Save, Tag, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import {
  createBlogCategorySlug,
  createBlogTagSlug,
} from "@/lib/blog-taxonomy-validation";
import { deleteBlogTaxonomy, saveBlogTaxonomy } from "@/lib/blog-taxonomy-client";
import type { BlogOperationRunResult } from "@/lib/blog-operation-coordinator";
import { recoverBlogTaxonomyDelete } from "@/lib/blog-taxonomy-recovery";
import type { AdminBlogCategory, AdminBlogTag } from "@/lib/blog-types";
import type { BlogTaxonomyKind } from "@/lib/blog-taxonomy-client";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";

interface CategoryValues {
  name: string;
  slug: string;
  description: string;
  sortOrder: string;
}

interface TagValues {
  name: string;
  slug: string;
}

type TaxonomyEditor =
  | { kind: "category"; id: string | null; initial: CategoryValues; values: CategoryValues; slugManuallyEdited: boolean }
  | { kind: "tag"; id: string | null; initial: TagValues; values: TagValues; slugManuallyEdited: boolean };

type PendingDelete = { kind: "category" | "tag"; id: string; name: string };

function categoryValues(category: AdminBlogCategory | null, nextSortOrder: number): CategoryValues {
  return {
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    sortOrder: String(category?.sortOrder ?? nextSortOrder),
  };
}

function tagValues(tag: AdminBlogTag | null): TagValues {
  return { name: tag?.name ?? "", slug: tag?.slug ?? "" };
}

export function BlogTaxonomyManager({
  categories,
  tags,
  operationPending,
  onCanStartOperation,
  onRunOperation,
  onBeginEditing,
  onCategorySaved,
  onDirtyChange,
  onRefreshAfterDelete,
  onTagSaved,
}: {
  categories: AdminBlogCategory[];
  tags: AdminBlogTag[];
  operationPending: boolean;
  onCanStartOperation: () => boolean;
  onRunOperation: <T>(operation: () => Promise<T>) => Promise<BlogOperationRunResult<T>>;
  onBeginEditing: () => boolean;
  onCategorySaved: (category: AdminBlogCategory) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onRefreshAfterDelete: (kind: BlogTaxonomyKind, deletionConfirmed: boolean) => Promise<boolean>;
  onTagSaved: (tag: AdminBlogTag) => void;
}) {
  const [editor, setEditor] = useState<TaxonomyEditor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<"category" | "tag">("category");

  const isDirty = editor !== null && hasUnsavedChanges(editor.initial, editor.values);
  const isLocked = operationPending || saving || Boolean(deletingId);

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  function canDismiss(): boolean {
    return confirmDiscardIfDirty(isDirty);
  }

  function openCategory(category: AdminBlogCategory | null) {
    if (operationPending || !onCanStartOperation()) return;
    if (!canDismiss() || !onBeginEditing()) return;
    const nextSortOrder = categories.reduce((highest, item) => Math.max(highest, item.sortOrder), -1) + 1;
    const values = categoryValues(category, nextSortOrder);
    setEditor({ kind: "category", id: category?.id ?? null, initial: values, values, slugManuallyEdited: false });
    setPendingDelete(null);
    setFieldErrors({});
    setError("");
    setSuccess("");
    setFeedbackKind("category");
  }

  function openTag(tag: AdminBlogTag | null) {
    if (operationPending || !onCanStartOperation()) return;
    if (!canDismiss() || !onBeginEditing()) return;
    const values = tagValues(tag);
    setEditor({ kind: "tag", id: tag?.id ?? null, initial: values, values, slugManuallyEdited: false });
    setPendingDelete(null);
    setFieldErrors({});
    setError("");
    setSuccess("");
    setFeedbackKind("tag");
  }

  function closeEditor() {
    if (operationPending || !onCanStartOperation()) return;
    if (!canDismiss()) return;
    setEditor(null);
    setFieldErrors({});
    setFeedbackKind("category");
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.kind !== "category" || saving || deletingId || operationPending || !onCanStartOperation()) return;
    await onRunOperation(async () => {
      setSaving(true);
      setError("");
      setSuccess("");
      setFeedbackKind("category");
      setFieldErrors({});

      try {
        const saved = await saveBlogTaxonomy("category", editor.id, {
          name: editor.values.name,
          slug: editor.values.slug,
          description: editor.values.description,
          sortOrder: Number(editor.values.sortOrder),
        });
        if (!saved.ok) {
          setError(saved.error);
          setFieldErrors(saved.fields);
          return;
        }
        if (!("category" in saved)) {
          setError("The server returned an unexpected response. Please reload the page.");
          return;
        }
        onCategorySaved(saved.category);
        setEditor(null);
        setSuccess(!editor.id
          ? "Category created. It is now available in the post editor."
          : "Category updated.");
      } catch {
        setError("Unable to save the category. Please try again.");
      } finally {
        setSaving(false);
      }
    });
  }

  async function saveTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editor.kind !== "tag" || saving || deletingId || operationPending || !onCanStartOperation()) return;
    await onRunOperation(async () => {
      setSaving(true);
      setError("");
      setSuccess("");
      setFeedbackKind("tag");
      setFieldErrors({});

      try {
        const saved = await saveBlogTaxonomy("tag", editor.id, {
          name: editor.values.name,
          slug: editor.values.slug,
        });
        if (!saved.ok) {
          setError(saved.error);
          setFieldErrors(saved.fields);
          return;
        }
        if (!("tag" in saved)) {
          setError("The server returned an unexpected response. Please reload the page.");
          return;
        }
        onTagSaved(saved.tag);
        setEditor(null);
        setSuccess(!editor.id
          ? "Tag created. It is now available in the post editor."
          : "Tag updated.");
      } catch {
        setError("Unable to save the tag. Please try again.");
      } finally {
        setSaving(false);
      }
    });
  }

  async function deleteTaxonomy(item: PendingDelete) {
    if (deletingId || saving || operationPending || !onCanStartOperation()) return;
    if (!onBeginEditing()) return;
    await onRunOperation(async () => {
      setDeletingId(item.id);
      setError("");
      setSuccess("");
      setFeedbackKind(item.kind);
      try {
        const recovery = await recoverBlogTaxonomyDelete(
          () => deleteBlogTaxonomy(item.kind, item.id),
          async (deletionConfirmed) => {
            setPendingDelete(null);
            return onRefreshAfterDelete(item.kind, deletionConfirmed);
          },
        );
        if (recovery.outcome === "rejected") {
          setError(recovery.error);
          return;
        }
        if (recovery.outcome === "refresh-failed") {
          setError(recovery.deletionConfirmed
            ? `The ${item.kind} was deleted successfully, but Blog data could not be refreshed. Use the retry control above.`
            : `The ${item.kind} deletion response was incomplete, and Blog data could not be refreshed. Use the retry control above.`);
          return;
        }
        if (recovery.outcome === "refreshed-uncertain") {
          setSuccess("Blog data was refreshed after an unexpected deletion response. Verify the current taxonomy state.");
          return;
        }
        if (item.kind === "category") {
          const count = recovery.count;
          setSuccess(count > 0
            ? `Category deleted. ${count} ${count === 1 ? "post is" : "posts are"} now uncategorized; no posts were deleted.`
            : "Category deleted. No posts were affected.");
        } else {
          const count = recovery.count;
          setSuccess(count > 0
            ? `Tag deleted and removed from ${count} ${count === 1 ? "post" : "posts"}. No posts were deleted.`
            : "Tag deleted. No posts were affected.");
        }
      } catch {
        setError(`Unable to delete the ${item.kind}. Please try again.`);
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <div className="blog-taxonomy">
      <section aria-labelledby="blog-categories-heading" className="project-management__category-section">
        <Card className="project-management__category-panel" variant="outlined">
          <div className="project-management__category-toolbar">
            <div>
              <p className="eyebrow">Organize writing</p>
              <h2 id="blog-categories-heading">Categories</h2>
              <p>Group related posts. Deleting a category leaves its posts intact and clears their category.</p>
            </div>
            <Button disabled={isLocked} onClick={() => openCategory(null)}>
              <FolderPlus aria-hidden="true" size={17} />
              Add category
            </Button>
          </div>

          {feedbackKind === "category" && error ? <p className="project-management__feedback project-management__feedback--error" role="alert">{error}</p> : null}
          {feedbackKind === "category" && success ? <p className="project-management__feedback project-management__feedback--success" role="status"><CheckCircle2 aria-hidden="true" size={16} />{success}</p> : null}
          {editor?.kind === "category" ? (
            <Card className="project-management__category-editor" variant="outlined">
              <div className="project-management__editor-heading">
                <div>
                  <p className="eyebrow">{editor.id ? "Edit category" : "New category"}</p>
                  <h3>{editor.initial.name || "Create a category"}</h3>
                </div>
                <Button aria-label="Close category editor" disabled={isLocked} onClick={closeEditor} size="small" variant="subtle">
                  <X aria-hidden="true" size={16} /> Close
                </Button>
              </div>
              <form className="project-management__form" onSubmit={(event) => void saveCategory(event)}>
                <div className="project-management__form-row">
                  <TextInput
                    disabled={isLocked}
                    error={fieldErrors.name}
                    id="blog-category-name"
                    label="Category name"
                    maxLength={100}
                    onChange={(event) => {
                      const name = event.target.value;
                      setEditor((current) => current?.kind === "category" ? {
                        ...current,
                        values: { ...current.values, name, slug: current.slugManuallyEdited ? current.values.slug : createBlogCategorySlug(name) },
                      } : current);
                    }}
                    required
                    value={editor.values.name}
                  />
                  <TextInput
                    disabled={isLocked}
                    error={fieldErrors.slug}
                    hint="Lowercase letters and numbers separated by hyphens."
                    id="blog-category-slug"
                    label="Slug"
                    maxLength={120}
                    onChange={(event) => setEditor((current) => current?.kind === "category" ? {
                      ...current,
                      values: { ...current.values, slug: event.target.value },
                      slugManuallyEdited: true,
                    } : current)}
                    required
                    value={editor.values.slug}
                  />
                </div>
                <div className="project-management__form-row">
                  <TextArea
                    disabled={isLocked}
                    error={fieldErrors.description}
                    id="blog-category-description"
                    label="Description"
                    maxLength={500}
                    onChange={(event) => setEditor((current) => current?.kind === "category" ? {
                      ...current,
                      values: { ...current.values, description: event.target.value },
                    } : current)}
                    rows={3}
                    value={editor.values.description}
                  />
                  <TextInput
                    disabled={isLocked}
                    error={fieldErrors.sortOrder}
                    id="blog-category-sort-order"
                    label="Display order"
                    max={999_999}
                    min={0}
                    onChange={(event) => setEditor((current) => current?.kind === "category" ? {
                      ...current,
                      values: { ...current.values, sortOrder: event.target.value },
                    } : current)}
                    type="number"
                    required
                    value={editor.values.sortOrder}
                  />
                </div>
                <div className="project-management__editor-actions">
                  <Button disabled={isLocked} onClick={closeEditor} type="button" variant="subtle"><X aria-hidden="true" size={15} />Cancel</Button>
                  <Button disabled={isLocked} type="submit">{saving ? <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} /> : <Save aria-hidden="true" size={15} />}{saving ? "Saving…" : "Save category"}</Button>
                </div>
              </form>
            </Card>
          ) : null}

          {categories.length === 0 ? (
            <div className="project-management__category-empty" role="status"><FolderPlus aria-hidden="true" size={19} /><p>No blog categories yet. Add one to organize posts.</p></div>
          ) : (
            <div className="project-management__category-list">
              {categories.map((category) => (
                <article className="project-management__category-item" key={category.id}>
                  <div className="project-management__category-copy">
                    <h3>{category.name}</h3>
                    <p className="project-management__category-slug">/{category.slug}</p>
                    <p className="project-management__category-description">{category.description || "No description provided."}</p>
                    <p className="project-management__meta">{category.postCount} {category.postCount === 1 ? "post" : "posts"}<span aria-hidden="true"> · </span>Display order: {category.sortOrder}</p>
                  </div>
                  <div className="project-management__category-actions">
                    <Button aria-label={`Edit category ${category.name}`} disabled={isLocked} onClick={() => openCategory(category)} size="small" variant="subtle"><Pencil aria-hidden="true" size={15} />Edit</Button>
                    <Button aria-label={`Delete category ${category.name}`} disabled={isLocked} onClick={() => {
                      if (!onCanStartOperation()) return;
                      if (!canDismiss()) return;
                      setEditor(null);
                      setPendingDelete({ kind: "category", id: category.id, name: category.name });
                      setFeedbackKind("category");
                    }} size="small" variant="subtle"><Trash2 aria-hidden="true" size={15} />Delete</Button>
                  </div>
                  {pendingDelete?.kind === "category" && pendingDelete.id === category.id ? (
                    <div aria-label={`Confirm deletion of category ${category.name}`} className="project-management__category-delete-confirm" role="group">
                      <div><strong>Delete {category.name}?</strong><p>{category.postCount > 0 ? `${category.postCount} ${category.postCount === 1 ? "post will" : "posts will"} remain and become uncategorized.` : "No posts will be changed."}</p></div>
                      <div className="project-management__confirm-actions">
                        <Button disabled={isLocked} onClick={() => void deleteTaxonomy(pendingDelete)} size="small">{deletingId === category.id ? <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} /> : <Trash2 aria-hidden="true" size={15} />}{deletingId === category.id ? "Deleting…" : "Confirm delete"}</Button>
                        <Button disabled={isLocked} onClick={() => setPendingDelete(null)} size="small" variant="subtle">Cancel</Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="blog-tags-heading" className="project-management__category-section">
        <Card className="project-management__category-panel" variant="outlined">
          <div className="project-management__category-toolbar">
            <div>
              <p className="eyebrow">Add context</p>
              <h2 id="blog-tags-heading">Tags</h2>
              <p>Attach one or more tags to posts. Deleting a tag removes its associations but keeps all posts.</p>
            </div>
            <Button disabled={isLocked} onClick={() => openTag(null)}>
              <Plus aria-hidden="true" size={17} />
              Add tag
            </Button>
          </div>

          {feedbackKind === "tag" && error ? <p className="project-management__feedback project-management__feedback--error" role="alert">{error}</p> : null}
          {feedbackKind === "tag" && success ? <p className="project-management__feedback project-management__feedback--success" role="status"><CheckCircle2 aria-hidden="true" size={16} />{success}</p> : null}
          {editor?.kind === "tag" ? (
            <Card className="project-management__category-editor" variant="outlined">
              <div className="project-management__editor-heading">
                <div>
                  <p className="eyebrow">{editor.id ? "Edit tag" : "New tag"}</p>
                  <h3>{editor.initial.name || "Create a tag"}</h3>
                </div>
                <Button aria-label="Close tag editor" disabled={isLocked} onClick={closeEditor} size="small" variant="subtle"><X aria-hidden="true" size={16} />Close</Button>
              </div>
              <form className="project-management__form" onSubmit={(event) => void saveTag(event)}>
                <div className="project-management__form-row">
                  <TextInput
                    disabled={isLocked}
                    error={fieldErrors.name}
                    id="blog-tag-name"
                    label="Tag name"
                    maxLength={80}
                    onChange={(event) => {
                      const name = event.target.value;
                      setEditor((current) => current?.kind === "tag" ? {
                        ...current,
                        values: { ...current.values, name, slug: current.slugManuallyEdited ? current.values.slug : createBlogTagSlug(name) },
                      } : current);
                    }}
                    required
                    value={editor.values.name}
                  />
                  <TextInput
                    disabled={isLocked}
                    error={fieldErrors.slug}
                    hint="Lowercase letters and numbers separated by hyphens."
                    id="blog-tag-slug"
                    label="Slug"
                    maxLength={100}
                    onChange={(event) => setEditor((current) => current?.kind === "tag" ? {
                      ...current,
                      values: { ...current.values, slug: event.target.value },
                      slugManuallyEdited: true,
                    } : current)}
                    required
                    value={editor.values.slug}
                  />
                </div>
                <div className="project-management__editor-actions">
                  <Button disabled={isLocked} onClick={closeEditor} type="button" variant="subtle"><X aria-hidden="true" size={15} />Cancel</Button>
                  <Button disabled={isLocked} type="submit">{saving ? <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} /> : <Save aria-hidden="true" size={15} />}{saving ? "Saving…" : "Save tag"}</Button>
                </div>
              </form>
            </Card>
          ) : null}

          {tags.length === 0 ? (
            <div className="project-management__category-empty" role="status"><Tag aria-hidden="true" size={19} /><p>No blog tags yet. Add one to make it available in the post editor.</p></div>
          ) : (
            <div className="project-management__category-list">
              {tags.map((tag) => (
                <article className="project-management__category-item" key={tag.id}>
                  <div className="project-management__category-copy">
                    <h3>{tag.name}</h3>
                    <p className="project-management__category-slug">/{tag.slug}</p>
                    <p className="project-management__meta">Associated with {tag.postCount} {tag.postCount === 1 ? "post" : "posts"}</p>
                  </div>
                  <div className="project-management__category-actions">
                    <Button aria-label={`Edit tag ${tag.name}`} disabled={isLocked} onClick={() => openTag(tag)} size="small" variant="subtle"><Pencil aria-hidden="true" size={15} />Edit</Button>
                    <Button aria-label={`Delete tag ${tag.name}`} disabled={isLocked} onClick={() => {
                      if (!onCanStartOperation()) return;
                      if (!canDismiss()) return;
                      setEditor(null);
                      setPendingDelete({ kind: "tag", id: tag.id, name: tag.name });
                      setFeedbackKind("tag");
                    }} size="small" variant="subtle"><Trash2 aria-hidden="true" size={15} />Delete</Button>
                  </div>
                  {pendingDelete?.kind === "tag" && pendingDelete.id === tag.id ? (
                    <div aria-label={`Confirm deletion of tag ${tag.name}`} className="project-management__category-delete-confirm" role="group">
                      <div><strong>Delete {tag.name}?</strong><p>{tag.postCount > 0 ? `Its association will be removed from ${tag.postCount} ${tag.postCount === 1 ? "post" : "posts"}. No posts will be deleted.` : "No posts will be changed."}</p></div>
                      <div className="project-management__confirm-actions">
                        <Button disabled={isLocked} onClick={() => void deleteTaxonomy(pendingDelete)} size="small">{deletingId === tag.id ? <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} /> : <Trash2 aria-hidden="true" size={15} />}{deletingId === tag.id ? "Deleting…" : "Confirm delete"}</Button>
                        <Button disabled={isLocked} onClick={() => setPendingDelete(null)} size="small" variant="subtle">Cancel</Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
