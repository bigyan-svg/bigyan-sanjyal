"use client";

import {
  Archive,
  CheckCircle2,
  FolderKanban,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ContentStatus, ProjectLinkType } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import {
  createProjectSlug,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_SORT_ORDER_MAX,
  type ProjectFieldErrors,
  type ProjectImageInput,
  type ProjectLinkInput,
  type ProjectStatus,
} from "@/lib/project-validation";
import {
  createProjectCategorySlug,
  PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH,
  PROJECT_CATEGORY_SORT_ORDER_MAX,
  type ProjectCategoryFieldErrors,
} from "@/lib/project-category-validation";
import type {
  AdminProjectCategory,
  AdminProjectSkillOption,
  AdminProjectItem,
  ProjectCategoryOption,
} from "@/lib/project-types";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";

interface ProjectPayload {
  title: string;
  slug: string;
  summary: string;
  description: string;
  categoryId: string;
  featured: boolean;
  sortOrder: number;
  status: ProjectStatus;
  skillIds?: string[];
  links?: ProjectLinkInput[];
  images?: ProjectImageInput[];
}

interface ProjectLinkDraft {
  key: string;
  type: ProjectLinkType;
  label: string;
  url: string;
}

interface ProjectImageDraft {
  key: string;
  imageUrl: string;
  altText: string;
  caption: string;
}

interface ProjectFormValues {
  title: string;
  slug: string;
  summary: string;
  description: string;
  categoryId: string;
  featured: boolean;
  sortOrder: string;
  status: ProjectStatus;
  skillIds: string[];
  links: ProjectLinkDraft[];
  images: ProjectImageDraft[];
}

function sortProjects(projects: AdminProjectItem[]): AdminProjectItem[] {
  return [...projects].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

function sortProjectCategories(categories: AdminProjectCategory[]): AdminProjectCategory[] {
  return [...categories].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  );
}

function responseError(result: unknown, fallback: string): string {
  if (typeof result === "object" && result !== null && "error" in result) {
    const error = result.error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function responseFields(result: unknown): ProjectFieldErrors {
  if (
    typeof result === "object" &&
    result !== null &&
    "fields" in result &&
    typeof result.fields === "object" &&
    result.fields !== null
  ) {
    return result.fields as ProjectFieldErrors;
  }
  return {};
}

function categoryResponseFields(result: unknown): ProjectCategoryFieldErrors {
  if (
    typeof result === "object" &&
    result !== null &&
    "fields" in result &&
    typeof result.fields === "object" &&
    result.fields !== null
  ) {
    return result.fields as ProjectCategoryFieldErrors;
  }
  return {};
}

function toProjectPayload(
  values: ProjectFormValues,
  sortOrder = Number(values.sortOrder),
  status = values.status,
): ProjectPayload {
  return {
    title: values.title,
    slug: values.slug,
    summary: values.summary,
    description: values.description,
    categoryId: values.categoryId,
    featured: values.featured,
    sortOrder,
    status,
    skillIds: values.skillIds,
    links: values.links.map((link, index) => ({
      type: link.type,
      label: link.label,
      url: link.url,
      sortOrder: index,
    })),
    images: values.images.map((image, index) => ({
      imageUrl: image.imageUrl,
      altText: image.altText,
      caption: image.caption,
      sortOrder: index,
    })),
  };
}

function toFormValues(
  project: AdminProjectItem | null,
  nextSortOrder: number,
): ProjectFormValues {
  return {
    title: project?.title ?? "",
    slug: project?.slug ?? "",
    summary: project?.summary ?? "",
    description: project?.description ?? "",
    categoryId: project?.categoryId ?? "",
    featured: project?.featured ?? false,
    sortOrder: String(project?.sortOrder ?? nextSortOrder),
    status: project?.status ?? "DRAFT",
    skillIds: project?.skills.map(({ skillId }) => skillId) ?? [],
    links: project?.links.map((link) => ({
      key: link.id,
      type: link.type,
      label: link.label,
      url: link.url,
    })) ?? [],
    images: project?.images.map((image) => ({
      key: image.id,
      imageUrl: image.imageUrl,
      altText: image.altText,
      caption: image.caption ?? "",
    })) ?? [],
  };
}

function statusLabel(status: ContentStatus): string {
  switch (status) {
    case "PUBLISHED":
      return "Published";
    case "ARCHIVED":
      return "Archived";
    default:
      return "Draft";
  }
}

function createEditorKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ProjectsManager({
  initialCategories,
  initialProjects,
  initialSkills,
}: {
  initialCategories: AdminProjectCategory[];
  initialProjects: AdminProjectItem[];
  initialSkills: AdminProjectSkillOption[];
}) {
  const [projects, setProjects] = useState(() => sortProjects(initialProjects));
  const [categories, setCategories] = useState(() => sortProjectCategories(initialCategories));
  const [editor, setEditor] = useState<{ project: AdminProjectItem | null } | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminProjectCategory | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const projectFormDirtyRef = useRef(false);
  const categoryFormDirtyRef = useRef(false);

  function canDismissProjectForm(): boolean {
    const canDismiss = confirmDiscardIfDirty(projectFormDirtyRef.current);
    if (canDismiss) projectFormDirtyRef.current = false;
    return canDismiss;
  }

  function canDismissCategoryForm(): boolean {
    const canDismiss = confirmDiscardIfDirty(categoryFormDirtyRef.current);
    if (canDismiss) categoryFormDirtyRef.current = false;
    return canDismiss;
  }

  function saveProject(project: AdminProjectItem) {
    projectFormDirtyRef.current = false;
    const previous = projects.find((item) => item.id === project.id);
    const previousCategoryId = previous?.categoryId ?? null;
    const nextCategoryId = project.categoryId;

    if (previousCategoryId !== nextCategoryId) {
      setCategories((current) => current.map((category) => ({
        ...category,
        projectCount: Math.max(
          0,
          category.projectCount +
            (category.id === previousCategoryId ? -1 : 0) +
            (category.id === nextCategoryId ? 1 : 0),
        ),
      })));
    }

    setProjects((current) =>
      sortProjects([...current.filter((item) => item.id !== project.id), project]),
    );
    setEditor(null);
    setPendingDelete(null);
    setPageError("");
    setPageSuccess("Project details saved.");
  }

  async function changeStatus(project: AdminProjectItem, status: ProjectStatus) {
    if (mutatingId || deletingId) return;
    setMutatingId(project.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/projects/${project.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: project.title,
          slug: project.slug,
          summary: project.summary,
          description: project.description ?? "",
          categoryId: project.categoryId ?? "",
          featured: project.featured,
          sortOrder: project.sortOrder,
          status,
        } satisfies ProjectPayload),
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setPageError(responseError(result, `Unable to change project status (HTTP ${response.status}).`));
        return;
      }

      if (!isProjectResponse(result)) {
        setPageError("The project was updated, but its details could not be loaded.");
        return;
      }

      setProjects((current) => sortProjects(current.map((item) =>
        item.id === result.project.id ? result.project : item,
      )));
      setPageSuccess(`Project moved to ${statusLabel(status).toLowerCase()}.`);
    } catch {
      setPageError("Unable to change project status. Please try again.");
    } finally {
      setMutatingId(null);
    }
  }

  async function deleteProject(project: AdminProjectItem) {
    if (mutatingId || deletingId) return;
    setDeletingId(project.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/projects/${project.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setPageError(responseError(result, `Unable to delete project (HTTP ${response.status}).`));
        return;
      }

      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (project.categoryId) {
        setCategories((current) => current.map((category) => category.id === project.categoryId
          ? { ...category, projectCount: Math.max(0, category.projectCount - 1) }
          : category));
      }
      setPendingDelete(null);
      setPageSuccess("Project permanently deleted.");
    } catch {
      setPageError("Unable to delete the project. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function saveCategory(category: AdminProjectCategory) {
    categoryFormDirtyRef.current = false;
    setCategories((current) => sortProjectCategories([
      ...current.filter((item) => item.id !== category.id),
      category,
    ]));
    setShowCategoryForm(false);
    setEditingCategory(null);
    setPageError("");
    setPageSuccess(editingCategory ? "Project category updated." : "Project category created.");
  }

  async function deleteCategory(category: AdminProjectCategory) {
    if (deletingCategoryId) return;

    setDeletingCategoryId(category.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/projects/categories/${category.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setPageError(responseError(result, `Unable to delete the category (HTTP ${response.status}).`));
        setPendingCategoryDelete(null);
        return;
      }

      setCategories((current) => current.filter((item) => item.id !== category.id));
      setPendingCategoryDelete(null);
      setPageSuccess("Project category deleted.");
    } catch {
      setPageError("Unable to delete the project category. Please try again.");
    } finally {
      setDeletingCategoryId(null);
    }
  }

  const nextSortOrder = projects.reduce(
    (highest, project) => Math.max(highest, project.sortOrder),
    -1,
  ) + 1;
  const isBusy = Boolean(mutatingId || deletingId || deletingCategoryId);
  const nextCategorySortOrder = categories.reduce(
    (highest, category) => Math.max(highest, category.sortOrder),
    -1,
  ) + 1;

  return (
    <div className="project-management">
      <section aria-labelledby="project-management-heading" className="project-management__toolbar">
        <div>
          <p className="eyebrow">Content library</p>
          <h2 id="project-management-heading">Projects</h2>
          <p>Manage project details and publication status. Public display is unchanged in this phase.</p>
        </div>
        <Button
          disabled={isBusy}
          onClick={() => {
            if (!canDismissProjectForm()) return;
            setEditor({ project: null });
            setPendingDelete(null);
            setPageError("");
          }}
        >
          <Plus aria-hidden="true" size={17} />
          Add project
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

      <section aria-labelledby="project-categories-heading" className="project-management__category-section">
        <Card className="project-management__category-panel" variant="outlined">
          <div className="project-management__category-toolbar">
            <div>
              <p className="eyebrow">Project organization</p>
              <h2 id="project-categories-heading">Project categories</h2>
              <p>Organize projects with reusable categories. Categories with projects cannot be deleted.</p>
            </div>
            <Button
              aria-expanded={showCategoryForm || Boolean(editingCategory)}
              disabled={isBusy}
              onClick={() => {
                if (!canDismissCategoryForm()) return;
                setShowCategoryForm(true);
                setEditingCategory(null);
                setPendingCategoryDelete(null);
                setPageError("");
                setPageSuccess("");
              }}
            >
              <FolderPlus aria-hidden="true" size={17} />
              Add category
            </Button>
          </div>

          {showCategoryForm || editingCategory ? (
            <ProjectCategoryForm
              key={editingCategory?.id ?? "new-project-category"}
              initialCategory={editingCategory}
              nextSortOrder={nextCategorySortOrder}
              onCancel={() => {
                if (!canDismissCategoryForm()) return;
                setShowCategoryForm(false);
                setEditingCategory(null);
              }}
              onDirtyChange={(isDirty) => { categoryFormDirtyRef.current = isDirty; }}
              onSaved={saveCategory}
            />
          ) : null}

          {categories.length === 0 ? (
            <div className="project-management__category-empty" role="status">
              <FolderPlus aria-hidden="true" size={20} />
              <p>No project categories have been added yet.</p>
            </div>
          ) : (
            <div className="project-management__category-list">
              {categories.map((category) => (
                <article
                  aria-labelledby={`project-category-${category.id}`}
                  className="project-management__category-item"
                  key={category.id}
                >
                  <div className="project-management__category-copy">
                    <h3 id={`project-category-${category.id}`}>{category.name}</h3>
                    <p className="project-management__category-slug">/{category.slug}</p>
                    <p className="project-management__category-description">
                      {category.description || "No description provided."}
                    </p>
                    <p className="project-management__meta">
                      {category.projectCount} {category.projectCount === 1 ? "project" : "projects"}
                      <span aria-hidden="true"> · </span>
                      Display order: {category.sortOrder}
                    </p>
                  </div>

                  <div className="project-management__category-actions">
                    <Button
                      disabled={isBusy}
                      onClick={() => {
                        if (!canDismissCategoryForm()) return;
                        setEditingCategory(category);
                        setShowCategoryForm(false);
                        setPendingCategoryDelete(null);
                        setPageError("");
                        setPageSuccess("");
                      }}
                      size="small"
                      variant="subtle"
                    >
                      <Pencil aria-hidden="true" size={15} />
                      Edit
                    </Button>
                    <Button
                      disabled={isBusy}
                      onClick={() => {
                        if (!canDismissCategoryForm()) return;
                        setEditingCategory(null);
                        setShowCategoryForm(false);
                        setPageSuccess("");
                        if (category.projectCount > 0) {
                          setPendingCategoryDelete(null);
                          setPageError(
                            `Cannot delete "${category.name}" because it contains ${category.projectCount} ${category.projectCount === 1 ? "project" : "projects"}. Reassign or remove them first.`,
                          );
                          return;
                        }
                        setPageError("");
                        setPendingCategoryDelete(category.id);
                      }}
                      size="small"
                      variant="subtle"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      Delete
                    </Button>
                  </div>

                  {pendingCategoryDelete === category.id ? (
                    <div
                      aria-label={`Confirm deletion of empty category ${category.name}`}
                      className="project-management__category-delete-confirm"
                      role="group"
                    >
                      <div>
                        <strong>Delete {category.name}?</strong>
                        <p>This category is empty. No project records will be changed.</p>
                      </div>
                      <div className="project-management__confirm-actions">
                        <Button
                          disabled={deletingCategoryId === category.id}
                          onClick={() => void deleteCategory(category)}
                          size="small"
                        >
                          {deletingCategoryId === category.id ? (
                            <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} />
                          ) : (
                            <Trash2 aria-hidden="true" size={15} />
                          )}
                          {deletingCategoryId === category.id ? "Deleting…" : "Confirm delete"}
                        </Button>
                        <Button
                          disabled={deletingCategoryId === category.id}
                          onClick={() => setPendingCategoryDelete(null)}
                          size="small"
                          variant="subtle"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Card>
      </section>

      {editor ? (
        <ProjectForm
          key={editor.project?.id ?? "new-project"}
          categories={categories}
          skills={initialSkills}
          initialProject={editor.project}
          nextSortOrder={nextSortOrder}
          onCancel={() => {
            if (!canDismissProjectForm()) return;
            setEditor(null);
          }}
          onDirtyChange={(isDirty) => { projectFormDirtyRef.current = isDirty; }}
          onSaved={saveProject}
        />
      ) : null}

      {projects.length === 0 ? (
        <Card className="project-management__empty" variant="outlined">
          <FolderKanban aria-hidden="true" size={24} />
          <h3>No projects have been added</h3>
          <p>Add a project when you have confirmed details ready to enter.</p>
          <Button
            disabled={isBusy}
            onClick={() => {
              if (!canDismissProjectForm()) return;
              setEditor({ project: null });
            }}
          >
            <Plus aria-hidden="true" size={17} />
            Add project
          </Button>
        </Card>
      ) : (
        <div className="project-management__list">
          {projects.map((project) => (
            <article aria-labelledby={`project-${project.id}`} className="project-management__item" key={project.id}>
              <div className="project-management__item-main">
                <div className="project-management__item-heading">
                  <h3 id={`project-${project.id}`}>{project.title}</h3>
                  <span className={`project-management__status project-management__status--${project.status.toLowerCase()}`}>
                    {statusLabel(project.status)}
                  </span>
                  {project.featured ? (
                    <span className="project-management__featured">
                      <Star aria-hidden="true" size={12} />
                      <span>Featured</span>
                    </span>
                  ) : null}
                </div>
                <p className="project-management__slug">/{project.slug}</p>
                <p className="project-management__summary">{project.summary}</p>
                <p className="project-management__meta">
                  Category: {project.category?.name ?? "Uncategorized"}
                  <span aria-hidden="true"> · </span>
                  Display order: {project.sortOrder}
                </p>
              </div>

              <div className="project-management__actions">
                <Button
                  disabled={isBusy}
                  onClick={() => {
                    if (!canDismissProjectForm()) return;
                    setEditor({ project });
                    setPendingDelete(null);
                    setPageError("");
                  }}
                  size="small"
                  variant="subtle"
                >
                  <Pencil aria-hidden="true" size={15} />
                  Edit
                </Button>
                <Button
                  disabled={isBusy || project.status === "PUBLISHED"}
                  onClick={() => void changeStatus(project, "PUBLISHED")}
                  size="small"
                  variant="secondary"
                >
                  {mutatingId === project.id ? (
                    <LoaderCircle aria-hidden="true" className="project-management__spinner" size={15} />
                  ) : (
                    <Send aria-hidden="true" size={15} />
                  )}
                  Publish
                </Button>
                <Button
                  disabled={isBusy || project.status === "DRAFT"}
                  onClick={() => void changeStatus(project, "DRAFT")}
                  size="small"
                  variant="subtle"
                >
                  <RotateCcw aria-hidden="true" size={15} />
                  Move to draft
                </Button>
                <Button
                  disabled={isBusy || project.status === "ARCHIVED"}
                  onClick={() => void changeStatus(project, "ARCHIVED")}
                  size="small"
                  variant="subtle"
                >
                  <Archive aria-hidden="true" size={15} />
                  Archive
                </Button>
                <Button
                  disabled={isBusy}
                  onClick={() => {
                    if (!canDismissProjectForm()) return;
                    setEditor(null);
                    setPageSuccess("");
                    setPageError("");
                    setPendingDelete(project.id);
                  }}
                  size="small"
                  variant="subtle"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  Delete
                </Button>
              </div>

              {pendingDelete === project.id ? (
                <div
                  className="project-management__delete-confirm"
                  role="group"
                  aria-label={`Confirm permanent deletion of ${project.title}`}
                >
                  <div>
                    <strong>Permanently delete {project.title}?</strong>
                    <p>This also deletes its related links, images, and skill associations. This cannot be undone.</p>
                  </div>
                  <div className="project-management__confirm-actions">
                    <Button
                      disabled={deletingId === project.id}
                      onClick={() => void deleteProject(project)}
                      size="small"
                    >
                      {deletingId === project.id ? "Deleting…" : "Confirm permanent delete"}
                    </Button>
                    <Button
                      disabled={deletingId === project.id}
                      onClick={() => setPendingDelete(null)}
                      size="small"
                      variant="subtle"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function isProjectResponse(result: unknown): result is { project: AdminProjectItem } {
  return (
    typeof result === "object" &&
    result !== null &&
    "project" in result &&
    typeof result.project === "object" &&
    result.project !== null
  );
}

function isProjectCategoryResponse(
  result: unknown,
): result is { category: AdminProjectCategory } {
  if (typeof result !== "object" || result === null || !("category" in result)) return false;
  const category = result.category;
  return (
    typeof category === "object" &&
    category !== null &&
    "id" in category && typeof category.id === "string" &&
    "name" in category && typeof category.name === "string" &&
    "slug" in category && typeof category.slug === "string" &&
    "description" in category &&
    (typeof category.description === "string" || category.description === null) &&
    "sortOrder" in category && typeof category.sortOrder === "number" &&
    "projectCount" in category && typeof category.projectCount === "number"
  );
}

function ProjectCategoryForm({
  initialCategory,
  nextSortOrder,
  onCancel,
  onDirtyChange,
  onSaved,
}: {
  initialCategory: AdminProjectCategory | null;
  nextSortOrder: number;
  onCancel: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (category: AdminProjectCategory) => void;
}) {
  const [initialValues] = useState(() => ({
    name: initialCategory?.name ?? "",
    description: initialCategory?.description ?? "",
    sortOrder: String(initialCategory?.sortOrder ?? nextSortOrder),
  }));
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [sortOrder, setSortOrder] = useState(initialValues.sortOrder);
  const isDirty = hasUnsavedChanges(initialValues, { name, description, sortOrder });
  const [errors, setErrors] = useState<ProjectCategoryFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = initialCategory !== null;
  const generatedSlug = createProjectCategorySlug(name);

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const parsedSortOrder = Number(sortOrder);
    const nextErrors: ProjectCategoryFieldErrors = {};
    if (!name.trim()) nextErrors.name = "Category name is required.";
    if (
      !sortOrder.trim() ||
      !Number.isInteger(parsedSortOrder) ||
      parsedSortOrder < 0 ||
      parsedSortOrder > PROJECT_CATEGORY_SORT_ORDER_MAX
    ) {
      nextErrors.sortOrder = `Enter a whole number from 0 to ${PROJECT_CATEGORY_SORT_ORDER_MAX.toLocaleString()}.`;
    }
    if (!generatedSlug) {
      nextErrors.name = "Use a category name that can form a short URL slug.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSaving(true);
    setErrors({});
    setErrorMessage("");

    try {
      const response = await fetch(
        initialCategory
          ? `/api/admin/projects/categories/${initialCategory.id}`
          : "/api/admin/projects/categories",
        {
          method: initialCategory ? "PATCH" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description, sortOrder: parsedSortOrder }),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(categoryResponseFields(result));
        setErrorMessage(responseError(
          result,
          `Unable to ${isEditing ? "update" : "create"} the category (HTTP ${response.status}).`,
        ));
        return;
      }

      if (!isProjectCategoryResponse(result)) {
        setErrorMessage("The category was saved, but its details could not be loaded.");
        return;
      }

      onSaved(result.category);
    } catch {
      setErrorMessage(`Unable to ${isEditing ? "update" : "create"} the category. Please try again.`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="project-management__category-editor" variant="outlined">
      <div className="project-management__editor-heading">
        <div>
          <p className="eyebrow">Project category</p>
          <h3>{isEditing ? "Edit category" : "Add a category"}</h3>
        </div>
        <Button
          aria-label="Close project category form"
          disabled={isSaving}
          onClick={onCancel}
          variant="subtle"
        >
          <X aria-hidden="true" size={17} />
          Close
        </Button>
      </div>

      <form aria-busy={isSaving} className="project-management__form" onSubmit={handleSubmit}>
        <TextInput
          autoComplete="off"
          error={errors.name}
          id="project-category-name"
          label="Name"
          maxLength={100}
          name="name"
          onChange={(event) => {
            setName(event.target.value);
            setErrors((current) => ({ ...current, name: undefined }));
            setErrorMessage("");
          }}
          required
          value={name}
        />

        <div className="project-management__field">
          <span className="form-field__label" id="project-category-slug-label">Generated slug</span>
          <p
            aria-labelledby="project-category-slug-label"
            aria-live="polite"
            className="project-management__category-slug-preview"
          >
            {generatedSlug ? `/${generatedSlug}` : "Enter a name using letters or numbers to generate a slug."}
          </p>
        </div>

        <TextArea
          error={errors.description}
          hint={`Optional. Up to ${PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`}
          id="project-category-description"
          label="Description"
          maxLength={PROJECT_CATEGORY_DESCRIPTION_MAX_LENGTH}
          name="description"
          onChange={(event) => {
            setDescription(event.target.value);
            setErrors((current) => ({ ...current, description: undefined }));
            setErrorMessage("");
          }}
          rows={3}
          value={description}
        />

        <TextInput
          error={errors.sortOrder}
          id="project-category-sort-order"
          label="Display order"
          max={PROJECT_CATEGORY_SORT_ORDER_MAX}
          min={0}
          name="sortOrder"
          onChange={(event) => {
            setSortOrder(event.target.value);
            setErrors((current) => ({ ...current, sortOrder: undefined }));
            setErrorMessage("");
          }}
          required
          type="number"
          value={sortOrder}
        />

        {errorMessage ? (
          <p className="project-management__feedback project-management__feedback--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="project-management__editor-actions">
          <Button disabled={isSaving} onClick={onCancel} variant="subtle">Cancel</Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="project-management__spinner" size={17} />
            ) : (
              isEditing ? <Save aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={17} />
            )}
            {isSaving ? "Saving…" : isEditing ? "Save changes" : "Save category"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ProjectForm({
  categories,
  skills,
  initialProject,
  nextSortOrder,
  onCancel,
  onDirtyChange,
  onSaved,
}: {
  categories: ProjectCategoryOption[];
  skills: AdminProjectSkillOption[];
  initialProject: AdminProjectItem | null;
  nextSortOrder: number;
  onCancel: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (project: AdminProjectItem) => void;
}) {
  const [initialValues] = useState(() => toFormValues(initialProject, nextSortOrder));
  const [values, setValues] = useState(initialValues);
  const isDirty = hasUnsavedChanges(initialValues, values);
  const [errors, setErrors] = useState<ProjectFieldErrors>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(Boolean(initialProject));
  const [relationSectionsDirty, setRelationSectionsDirty] = useState({
    skillIds: false,
    links: false,
    images: false,
  });
  const isEditing = initialProject !== null;

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  function updateField<K extends keyof ProjectFormValues>(field: K, value: ProjectFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === "skillIds" || field === "links" || field === "images") {
      setRelationSectionsDirty((current) => ({ ...current, [field]: true }));
    }
    setErrorMessage("");
  }

  function updateLink(key: string, update: Partial<ProjectLinkDraft>) {
    updateField("links", values.links.map((link) => link.key === key ? { ...link, ...update } : link));
  }

  function updateImage(key: string, update: Partial<ProjectImageDraft>) {
    updateField("images", values.images.map((image) => image.key === key ? { ...image, ...update } : image));
  }

  function moveLink(index: number, direction: -1 | 1) {
    const next = [...values.links];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    updateField("links", next);
  }

  function moveImage(index: number, direction: -1 | 1) {
    const next = [...values.images];
    const destination = index + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    updateField("images", next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const sortOrder = Number(values.sortOrder);
    if (
      !values.sortOrder ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > PROJECT_SORT_ORDER_MAX
    ) {
      setErrors((current) => ({
        ...current,
        sortOrder: `Enter a whole number from 0 to ${PROJECT_SORT_ORDER_MAX.toLocaleString()}.`,
      }));
      return;
    }

    setIsSaving(true);
    setErrors({});
    setErrorMessage("");

    try {
      const payload = toProjectPayload(values, sortOrder);
      if (initialProject) {
        if (!relationSectionsDirty.skillIds) delete payload.skillIds;
        if (!relationSectionsDirty.links) delete payload.links;
        if (!relationSectionsDirty.images) delete payload.images;
      }
      const response = await fetch(
        initialProject ? `/api/admin/projects/${initialProject.id}` : "/api/admin/projects",
        {
          method: initialProject ? "PATCH" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setErrors(responseFields(result));
        setErrorMessage(responseError(result, `Unable to save the project (HTTP ${response.status}).`));
        return;
      }

      if (!isProjectResponse(result)) {
        setErrorMessage("The project was saved, but its details could not be loaded.");
        return;
      }

      onSaved(result.project);
    } catch {
      setErrorMessage("Unable to save the project. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="project-management__editor" variant="outlined">
      <div className="project-management__editor-heading">
        <div>
          <p className="eyebrow">Project details</p>
          <h3>{isEditing ? "Edit project" : "Add a project"}</h3>
        </div>
        <Button aria-label="Close project form" disabled={isSaving} onClick={onCancel} variant="subtle">
          <X aria-hidden="true" size={17} />
          Close
        </Button>
      </div>

      <form aria-busy={isSaving} className="project-management__form" onSubmit={handleSubmit}>
        <section aria-labelledby="project-basic-information-title" className="project-management__form-section">
          <h4 id="project-basic-information-title">Basic Information</h4>
          <div className="project-management__form-row">
            <TextInput
              autoComplete="off"
              error={errors.title}
              id="project-title"
              label="Title"
              maxLength={200}
              name="title"
              onChange={(event) => {
                const title = event.target.value;
                updateField("title", title);
                if (!slugManuallyEdited) updateField("slug", createProjectSlug(title));
              }}
              required
              value={values.title}
            />
            <TextInput
              autoComplete="off"
              error={errors.slug}
              hint="Lowercase letters and numbers separated by hyphens."
              id="project-slug"
              label="Slug"
              maxLength={180}
              name="slug"
              onChange={(event) => {
                setSlugManuallyEdited(true);
                updateField("slug", event.target.value);
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
              value={values.slug}
            />
          </div>

          <TextArea
            error={errors.summary}
            hint="A short summary used to describe this project."
            id="project-summary"
            label="Summary"
            maxLength={400}
            name="summary"
            onChange={(event) => updateField("summary", event.target.value)}
            required
            rows={2}
            value={values.summary}
          />

          <TextArea
            error={errors.description}
            hint={`Optional. Up to ${PROJECT_DESCRIPTION_MAX_LENGTH.toLocaleString()} characters.`}
            id="project-description"
            label="Description"
            maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
            name="description"
            onChange={(event) => updateField("description", event.target.value)}
            rows={5}
            value={values.description}
          />
        </section>

        <section aria-labelledby="project-category-section-title" className="project-management__form-section">
          <h4 id="project-category-section-title">Project Category</h4>
          <div className="project-management__field">
            <label className="form-field__label" htmlFor="project-category">Category</label>
            <select
              aria-describedby={errors.categoryId ? "project-category-error" : undefined}
              aria-invalid={errors.categoryId ? true : undefined}
              className="form-control"
              id="project-category"
              name="categoryId"
              onChange={(event) => updateField("categoryId", event.target.value)}
              value={values.categoryId}
            >
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            {errors.categoryId ? (
              <span className="form-field__message form-field__message--error" id="project-category-error">
                {errors.categoryId}
              </span>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="project-skills-section-title" className="project-management__form-section">
          <h4 id="project-skills-section-title">Technologies / Skills</h4>
          <p className="project-management__form-hint">Select existing skills. Skill records are managed separately.</p>
          {values.skillIds.length > 0 ? (
            <ul aria-label="Selected skills" className="project-management__selected-skills">
              {values.skillIds.map((skillId) => {
                const skill = skills.find((item) => item.id === skillId);
                return skill ? (
                  <li key={skill.id}>
                    <span>{skill.name}</span>
                    <span className="project-management__selected-skill-meta">
                      {skill.categoryName} · {statusLabel(skill.status)}
                    </span>
                    <Button
                      aria-label={`Remove ${skill.name} from this project`}
                      disabled={isSaving}
                      onClick={() => updateField("skillIds", values.skillIds.filter((id) => id !== skill.id))}
                      size="small"
                      variant="subtle"
                    >
                      Remove
                    </Button>
                  </li>
                ) : null;
              })}
            </ul>
          ) : (
            <p className="project-management__form-hint">No skills selected.</p>
          )}
          {skills.length > 0 ? (
            <div className="project-management__skill-options">
              {skills.map((skill) => (
                <label className="project-management__skill-option" htmlFor={`project-skill-${skill.id}`} key={skill.id}>
                  <input
                    checked={values.skillIds.includes(skill.id)}
                    disabled={isSaving}
                    id={`project-skill-${skill.id}`}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...new Set([...values.skillIds, skill.id])]
                        : values.skillIds.filter((id) => id !== skill.id);
                      updateField("skillIds", next);
                    }}
                    type="checkbox"
                  />
                  <span>{skill.name}</span>
                  <small>{skill.categoryName} · {statusLabel(skill.status)}</small>
                </label>
              ))}
            </div>
          ) : (
            <p className="project-management__form-hint">No skills are available yet. Add skills in Skills Management.</p>
          )}
          {errors.skillIds ? <p className="project-management__field-error" role="alert">{errors.skillIds}</p> : null}
        </section>

        <section aria-labelledby="project-links-section-title" className="project-management__form-section">
          <div className="project-management__section-heading">
            <div>
              <h4 id="project-links-section-title">Project Links</h4>
              <p className="project-management__form-hint">Published projects require HTTPS links. Draft projects may use localhost HTTP links for development.</p>
            </div>
            <Button
              disabled={isSaving || values.links.length >= 20}
              onClick={() => updateField("links", [...values.links, {
                key: createEditorKey(), type: "OTHER", label: "", url: "",
              }])}
              size="small"
              variant="secondary"
            >
              <Plus aria-hidden="true" size={15} /> Add link
            </Button>
          </div>
          {values.links.length === 0 ? <p className="project-management__form-hint">No project links added.</p> : null}
          <div className="project-management__relation-list">
            {values.links.map((link, index) => (
              <fieldset className="project-management__relation-item" key={link.key}>
                <legend>Link {index + 1}</legend>
                <div className="project-management__form-row">
                  <div className="project-management__field">
                    <label className="form-field__label" htmlFor={`project-link-${link.key}-type`}>Type</label>
                    <select
                      className="form-control"
                      id={`project-link-${link.key}-type`}
                      onChange={(event) => updateLink(link.key, { type: event.target.value as ProjectLinkType })}
                      value={link.type}
                    >
                      <option value="GITHUB_REPOSITORY">GitHub Repository</option>
                      <option value="LIVE_DEMO">Live Demo</option>
                      <option value="DOCUMENTATION">Documentation</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <TextInput
                    autoComplete="off"
                    id={`project-link-${link.key}-label`}
                    label="Label"
                    maxLength={80}
                    onChange={(event) => updateLink(link.key, { label: event.target.value })}
                    required
                    value={link.label}
                  />
                </div>
                <TextInput
                  autoComplete="url"
                  hint="Use a full HTTPS URL. Localhost HTTP is only accepted on draft projects."
                  id={`project-link-${link.key}-url`}
                  label="URL"
                  maxLength={2_048}
                  onChange={(event) => updateLink(link.key, { url: event.target.value })}
                  required
                  type="url"
                  value={link.url}
                />
                <div className="project-management__relation-actions">
                  <Button aria-label={`Move link ${index + 1} up`} disabled={isSaving || index === 0} onClick={() => moveLink(index, -1)} size="small" variant="subtle">Move up</Button>
                  <Button aria-label={`Move link ${index + 1} down`} disabled={isSaving || index === values.links.length - 1} onClick={() => moveLink(index, 1)} size="small" variant="subtle">Move down</Button>
                  <Button aria-label={`Remove link ${index + 1}`} disabled={isSaving} onClick={() => updateField("links", values.links.filter((item) => item.key !== link.key))} size="small" variant="subtle">
                    <Trash2 aria-hidden="true" size={14} /> Remove link
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
          {errors.links ? <p className="project-management__field-error" role="alert">{errors.links}</p> : null}
        </section>

        <section aria-labelledby="project-images-section-title" className="project-management__form-section">
          <div className="project-management__section-heading">
            <div>
              <h4 id="project-images-section-title">Project Images</h4>
              <p className="project-management__form-hint">Add HTTPS image URLs and descriptive alternative text. The first image is primary.</p>
            </div>
            <Button
              disabled={isSaving || values.images.length >= 20}
              onClick={() => updateField("images", [...values.images, {
                key: createEditorKey(), imageUrl: "", altText: "", caption: "",
              }])}
              size="small"
              variant="secondary"
            >
              <Plus aria-hidden="true" size={15} /> Add image
            </Button>
          </div>
          {values.images.length === 0 ? <p className="project-management__form-hint">No project images added.</p> : null}
          <div className="project-management__relation-list">
            {values.images.map((image, index) => (
              <fieldset className="project-management__relation-item" key={image.key}>
                <legend>
                  Image {index + 1}{index === 0 ? <span className="project-management__primary-label">Primary</span> : null}
                </legend>
                <TextInput
                  autoComplete="url"
                  hint="Public images must use HTTPS."
                  id={`project-image-${image.key}-url`}
                  label="Image URL"
                  maxLength={2_048}
                  onChange={(event) => updateImage(image.key, { imageUrl: event.target.value })}
                  required
                  type="url"
                  value={image.imageUrl}
                />
                <TextInput
                  autoComplete="off"
                  hint="Describe the image for visitors using assistive technology."
                  id={`project-image-${image.key}-alt`}
                  label="Alternative text"
                  maxLength={300}
                  onChange={(event) => updateImage(image.key, { altText: event.target.value })}
                  required
                  value={image.altText}
                />
                <TextArea
                  id={`project-image-${image.key}-caption`}
                  label="Caption"
                  maxLength={500}
                  onChange={(event) => updateImage(image.key, { caption: event.target.value })}
                  rows={2}
                  value={image.caption}
                />
                <div className="project-management__relation-actions">
                  <Button aria-label={`Move image ${index + 1} up`} disabled={isSaving || index === 0} onClick={() => moveImage(index, -1)} size="small" variant="subtle">Move up</Button>
                  <Button aria-label={`Move image ${index + 1} down`} disabled={isSaving || index === values.images.length - 1} onClick={() => moveImage(index, 1)} size="small" variant="subtle">Move down</Button>
                  <Button aria-label={`Remove image ${index + 1}`} disabled={isSaving} onClick={() => updateField("images", values.images.filter((item) => item.key !== image.key))} size="small" variant="subtle">
                    <Trash2 aria-hidden="true" size={14} /> Remove image
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
          {errors.images ? <p className="project-management__field-error" role="alert">{errors.images}</p> : null}
        </section>

        <section aria-labelledby="project-publication-section-title" className="project-management__form-section">
          <h4 id="project-publication-section-title">Publication Settings</h4>
          <div className="project-management__form-row project-management__form-row--controls">
            <div className="project-management__field">
              <label className="form-field__label" htmlFor="project-status">Status</label>
              <select
                aria-describedby={errors.status ? "project-status-error" : undefined}
                aria-invalid={errors.status ? true : undefined}
                className="form-control"
                id="project-status"
                name="status"
                onChange={(event) => updateField("status", event.target.value as ProjectStatus)}
                value={values.status}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              {errors.status ? <span className="form-field__message form-field__message--error" id="project-status-error">{errors.status}</span> : null}
            </div>

            <TextInput
              error={errors.sortOrder}
              id="project-sort-order"
              label="Display order"
              max={PROJECT_SORT_ORDER_MAX}
              min={0}
              name="sortOrder"
              onChange={(event) => updateField("sortOrder", event.target.value)}
              required
              type="number"
              value={values.sortOrder}
            />

            <label className="project-management__featured-control" htmlFor="project-featured">
              <input
                checked={values.featured}
                id="project-featured"
                name="featured"
                onChange={(event) => updateField("featured", event.target.checked)}
                type="checkbox"
              />
              <span>Feature this project</span>
            </label>
          </div>
          {errors.featured ? <span className="form-field__message form-field__message--error">{errors.featured}</span> : null}
        </section>

        {errorMessage ? (
          <p className="project-management__feedback project-management__feedback--error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <div className="project-management__editor-actions">
          <Button disabled={isSaving} onClick={onCancel} variant="subtle">Cancel</Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="project-management__spinner" size={17} />
            ) : (
              isEditing ? <Save aria-hidden="true" size={17} /> : <Plus aria-hidden="true" size={17} />
            )}
            {isSaving ? "Saving…" : isEditing ? "Save changes" : "Save project"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
