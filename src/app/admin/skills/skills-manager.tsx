"use client";

import {
  CheckCircle2,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ContentStatus } from "@/generated/prisma/client";
import { SkillIcon } from "@/components/skills/skill-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextArea, TextInput } from "@/components/ui/form-field";
import { SKILL_ICON_OPTIONS } from "@/lib/skill-icons";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";
import type { SkillCategoryItem, SkillItem } from "@/lib/skill-types";

type SkillFormValues = {
  name: string;
  categoryId: string;
  proficiencyLabel: string;
  description: string;
  icon: string;
  sortOrder: string;
  status: ContentStatus;
};

type SkillField = keyof SkillFormValues;
type SkillFieldErrors = Partial<Record<SkillField | "description", string>>;

function sortedSkills(skills: SkillItem[]): SkillItem[] {
  return [...skills].sort(
    (left, right) =>
      left.category.name.localeCompare(right.category.name) ||
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name),
  );
}

function responseError(result: unknown, fallback: string): string {
  if (typeof result === "object" && result !== null && "error" in result) {
    const error = result.error;
    if (typeof error === "string") return error;
  }
  return fallback;
}

function responseFields(result: unknown): SkillFieldErrors {
  if (
    typeof result === "object" &&
    result !== null &&
    "fields" in result &&
    typeof result.fields === "object" &&
    result.fields !== null
  ) {
    return result.fields as SkillFieldErrors;
  }
  return {};
}

function logCategorySaveDiagnostic(details: {
  phase: "network" | "non-json-response" | "invalid-success-response";
  errorName?: string;
  status?: number;
  contentType?: string | null;
}): void {
  if (process.env.NODE_ENV !== "development") return;
  console.error("Admin skill category save diagnostic.", details);
}

function getNextSortOrder(categoryId: string, skills: SkillItem[]): number {
  return (
    skills
      .filter((skill) => skill.categoryId === categoryId)
      .reduce((highest, skill) => Math.max(highest, skill.sortOrder), -1) + 1
  );
}

function toSkillFormValues(
  skill: SkillItem | null,
  categories: SkillCategoryItem[],
  skills: SkillItem[],
): SkillFormValues {
  const categoryId = skill?.categoryId ?? categories[0]?.id ?? "";
  return {
    name: skill?.name ?? "",
    categoryId,
    proficiencyLabel: skill?.proficiencyLabel ?? "",
    description: skill?.description ?? "",
    icon: skill?.icon ?? "",
    sortOrder: String(skill?.sortOrder ?? getNextSortOrder(categoryId, skills)),
    status: skill?.status ?? "DRAFT",
  };
}

export function SkillsManager({
  initialCategories,
  initialSkills,
}: {
  initialCategories: SkillCategoryItem[];
  initialSkills: SkillItem[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [skills, setSkills] = useState(initialSkills);
  const [editor, setEditor] = useState<{ skill: SkillItem | null } | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<SkillCategoryItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const skillFormDirtyRef = useRef(false);
  const categoryFormDirtyRef = useRef(false);

  function canDismissCurrentForm(): boolean {
    if (editor && !confirmDiscardIfDirty(skillFormDirtyRef.current)) return false;
    if ((showCategoryForm || editingCategory) && !confirmDiscardIfDirty(categoryFormDirtyRef.current)) return false;

    skillFormDirtyRef.current = false;
    categoryFormDirtyRef.current = false;
    return true;
  }

  function saveSkill(skill: SkillItem) {
    skillFormDirtyRef.current = false;
    setSkills((current) => sortedSkills([
      ...current.filter((item) => item.id !== skill.id),
      skill,
    ]));
    setEditor(null);
    setPageError("");
    setPageSuccess("Skill details saved.");
  }

  function saveCategory(category: SkillCategoryItem) {
    categoryFormDirtyRef.current = false;
    const isUpdate = categories.some((item) => item.id === category.id);
    setCategories((current) => [
      ...current.filter((item) => item.id !== category.id),
      category,
    ].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    ));
    setShowCategoryForm(false);
    setEditingCategory(null);
    setPageError("");
    setPageSuccess(
      isUpdate ? "Category details saved." : "Category added. You can now assign skills to it.",
    );
  }

  async function deleteCategory(category: SkillCategoryItem) {
    if (deletingCategoryId) return;

    const skillCount = skills.filter((skill) => skill.categoryId === category.id).length;
    if (skillCount > 0) {
      setPendingCategoryDelete(null);
      setPageSuccess("");
      setPageError(
        `Cannot delete "${category.name}" because it contains ${skillCount} ${skillCount === 1 ? "skill" : "skills"}. Remove or reassign them first.`,
      );
      return;
    }

    setDeletingCategoryId(category.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/skills/categories/${category.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setPageError(responseError(result, "Unable to delete the category. Please try again."));
        return;
      }

      setCategories((current) => current.filter((item) => item.id !== category.id));
      setPendingCategoryDelete(null);
      setPageSuccess("Category deleted.");
    } catch {
      setPageError("Unable to delete the category. Please try again.");
    } finally {
      setDeletingCategoryId(null);
    }
  }

  async function changeStatus(skill: SkillItem) {
    if (updatingId) return;
    const nextStatus: ContentStatus = skill.status === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    setUpdatingId(skill.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/skills/${skill.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok || typeof result !== "object" || result === null || !("skill" in result)) {
        setPageError(responseError(result, "Unable to update the skill. Please try again."));
        return;
      }

      const updatedSkill = result.skill as SkillItem;
      setSkills((current) => sortedSkills(current.map((item) =>
        item.id === updatedSkill.id ? updatedSkill : item,
      )));
      setPageSuccess(nextStatus === "PUBLISHED" ? "Skill published." : "Skill moved to draft.");
    } catch {
      setPageError("Unable to update the skill. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteSkill(skill: SkillItem) {
    if (deletingId) return;
    setDeletingId(skill.id);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(`/api/admin/skills/${skill.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setPageError(responseError(result, "Unable to delete the skill. Please try again."));
        return;
      }

      setSkills((current) => current.filter((item) => item.id !== skill.id));
      setPendingDelete(null);
      setPageSuccess("Skill deleted.");
    } catch {
      setPageError("Unable to delete the skill. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="skill-management">
      <section aria-labelledby="skill-management-heading" className="skill-management__toolbar">
        <div>
          <p className="eyebrow">Content library</p>
          <h2 id="skill-management-heading">Skills and categories</h2>
          <p>Only published skills appear on the public Skills page.</p>
        </div>
        <div className="skill-management__toolbar-actions">
          <Button
            onClick={() => {
              if (!canDismissCurrentForm()) return;
              if (showCategoryForm) {
                setShowCategoryForm(false);
              } else {
                setEditingCategory(null);
                setShowCategoryForm(true);
              }
              setEditor(null);
            }}
            variant="secondary"
          >
            <FolderPlus aria-hidden="true" size={17} />
            {showCategoryForm ? "Close category form" : "Add category"}
          </Button>
          <Button
            disabled={categories.length === 0}
            onClick={() => {
              if (!canDismissCurrentForm()) return;
              setEditor({ skill: null });
              setShowCategoryForm(false);
              setEditingCategory(null);
            }}
          >
            <Plus aria-hidden="true" size={17} />
            Add skill
          </Button>
        </div>
      </section>

      {pageSuccess ? (
        <p className="skill-management__feedback skill-management__feedback--success" role="status">
          <CheckCircle2 aria-hidden="true" size={17} />
          {pageSuccess}
        </p>
      ) : null}
      {pageError ? (
        <p className="skill-management__feedback skill-management__feedback--error" role="alert">
          {pageError}
        </p>
      ) : null}

      {showCategoryForm || editingCategory ? (
        <CategoryForm
          key={editingCategory?.id ?? "new-category"}
          initialCategory={editingCategory}
          onCancel={() => {
            if (!canDismissCurrentForm()) return;
            setShowCategoryForm(false);
            setEditingCategory(null);
          }}
          onDirtyChange={(isDirty) => { categoryFormDirtyRef.current = isDirty; }}
          onSaved={saveCategory}
        />
      ) : null}

      {editor ? (
        <SkillEditor
          key={editor.skill?.id ?? "new-skill"}
          categories={categories}
          initialSkill={editor.skill}
          skills={skills}
          onCancel={() => {
            if (!canDismissCurrentForm()) return;
            setEditor(null);
          }}
          onDirtyChange={(isDirty) => { skillFormDirtyRef.current = isDirty; }}
          onSaved={saveSkill}
        />
      ) : null}

      {categories.length === 0 ? (
        <Card className="skill-management__empty" variant="outlined">
          <FolderPlus aria-hidden="true" size={24} />
          <h3>Create a category to get started</h3>
          <p>Skills need a category before they can be added. Add only categories you want to use.</p>
          <Button onClick={() => {
            if (!canDismissCurrentForm()) return;
            setShowCategoryForm(true);
          }}>
            <FolderPlus aria-hidden="true" size={17} />
            Add a category
          </Button>
        </Card>
      ) : (
        <div className="skill-management__groups">
          {categories.map((category) => {
            const categorySkills = sortedSkills(
              skills.filter((skill) => skill.categoryId === category.id),
            );

            return (
              <section
                aria-labelledby={`skill-category-${category.id}`}
                className="skill-management__group"
                key={category.id}
              >
                <header className="skill-management__group-heading">
                  <div>
                    <p className="eyebrow">Category</p>
                    <h3 id={`skill-category-${category.id}`}>{category.name}</h3>
                    {category.description ? (
                      <p className="skill-management__category-description">{category.description}</p>
                    ) : null}
                  </div>
                  <div className="skill-management__group-tools">
                    <span className="skill-management__count">
                      {categorySkills.length} {categorySkills.length === 1 ? "skill" : "skills"}
                    </span>
                    <div className="skill-management__category-actions">
                      <Button
                        disabled={Boolean(updatingId || deletingId || deletingCategoryId)}
                        onClick={() => {
                          if (!canDismissCurrentForm()) return;
                          setEditingCategory(category);
                          setShowCategoryForm(false);
                          setEditor(null);
                          setPendingCategoryDelete(null);
                          setPageError("");
                        }}
                        size="small"
                        variant="subtle"
                      >
                        <Pencil aria-hidden="true" size={15} />
                        Edit
                      </Button>
                      <Button
                        disabled={Boolean(updatingId || deletingId || deletingCategoryId)}
                        onClick={() => {
                          if (!canDismissCurrentForm()) return;
                          setShowCategoryForm(false);
                          setEditingCategory(null);
                          setEditor(null);
                          setPageSuccess("");
                          setPendingCategoryDelete(null);
                          if (categorySkills.length > 0) {
                            setPageError(
                              `Cannot delete "${category.name}" because it contains ${categorySkills.length} ${categorySkills.length === 1 ? "skill" : "skills"}. Remove or reassign them first.`,
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
                  </div>
                </header>

                {categorySkills.length === 0 ? (
                  <p className="skill-management__category-empty">No skills in this category yet</p>
                ) : (
                  <ul className="skill-management__list">
                    {categorySkills.map((skill) => (
                      <li className="skill-management__item" key={skill.id}>
                        <div className="skill-management__item-main">
                          {skill.icon ? (
                            <span aria-hidden="true" className="skill-management__icon">
                              <SkillIcon name={skill.icon} />
                            </span>
                          ) : null}
                          <div className="skill-management__item-copy">
                            <div className="skill-management__item-title">
                              <h4>{skill.name}</h4>
                              <span className={`skill-management__status skill-management__status--${skill.status.toLowerCase()}`}>
                                {skill.status === "PUBLISHED" ? "Published" : skill.status === "DRAFT" ? "Draft" : "Archived"}
                              </span>
                            </div>
                            {skill.proficiencyLabel ? (
                              <p className="skill-management__proficiency">{skill.proficiencyLabel}</p>
                            ) : null}
                            {skill.description ? (
                              <p className="skill-management__description">{skill.description}</p>
                            ) : null}
                            <p className="skill-management__order">Display order: {skill.sortOrder}</p>
                          </div>
                        </div>

                        <div className="skill-management__item-actions">
                          <Button
                            disabled={Boolean(updatingId || deletingId)}
                            onClick={() => void changeStatus(skill)}
                            size="small"
                            variant="secondary"
                          >
                            {updatingId === skill.id ? (
                              <LoaderCircle aria-hidden="true" className="skill-management__spinner" size={15} />
                            ) : null}
                            {skill.status === "PUBLISHED" ? "Unpublish" : "Publish"}
                          </Button>
                          <Button
                            disabled={Boolean(updatingId || deletingId)}
                            onClick={() => {
                              if (!canDismissCurrentForm()) return;
                              setEditor({ skill });
                              setShowCategoryForm(false);
                              setEditingCategory(null);
                            }}
                            size="small"
                            variant="subtle"
                          >
                            <Pencil aria-hidden="true" size={15} />
                            Edit
                          </Button>
                          <Button
                            disabled={Boolean(updatingId || deletingId)}
                            onClick={() => setPendingDelete(skill.id)}
                            size="small"
                            variant="subtle"
                          >
                            <Trash2 aria-hidden="true" size={15} />
                            Delete
                          </Button>
                        </div>

                        {pendingDelete === skill.id ? (
                          <div className="skill-management__delete-confirm" role="group" aria-label={`Confirm deletion of ${skill.name}`}>
                            <p>
                              Delete {skill.name}? Any project links to this skill will also be removed.
                            </p>
                            <div>
                              <Button
                                disabled={deletingId === skill.id}
                                onClick={() => void deleteSkill(skill)}
                                size="small"
                                variant="primary"
                              >
                                {deletingId === skill.id ? "Deleting…" : "Confirm delete"}
                              </Button>
                              <Button
                                disabled={deletingId === skill.id}
                                onClick={() => setPendingDelete(null)}
                                size="small"
                                variant="subtle"
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {pendingCategoryDelete === category.id ? (
                  <div
                    className="skill-management__delete-confirm"
                    role="group"
                    aria-label={`Confirm deletion of ${category.name}`}
                  >
                    <p>Delete {category.name}? Only empty categories can be deleted.</p>
                    <div>
                      <Button
                        disabled={deletingCategoryId === category.id}
                        onClick={() => void deleteCategory(category)}
                        size="small"
                      >
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SkillEditor({
  categories,
  initialSkill,
  skills,
  onCancel,
  onDirtyChange,
  onSaved,
}: {
  categories: SkillCategoryItem[];
  initialSkill: SkillItem | null;
  skills: SkillItem[];
  onCancel: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (skill: SkillItem) => void;
}) {
  const [initialValues] = useState(() => toSkillFormValues(initialSkill, categories, skills));
  const [values, setValues] = useState(initialValues);
  const isDirty = hasUnsavedChanges(initialValues, values);
  const [errors, setErrors] = useState<SkillFieldErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  function updateField(field: SkillField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setErrorMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const numericOrder = Number(values.sortOrder);
    if (!values.sortOrder || !Number.isInteger(numericOrder) || numericOrder < 0 || numericOrder > 999_999) {
      setErrors((current) => ({ ...current, sortOrder: "Enter a whole number from 0 to 999,999." }));
      return;
    }

    setIsSaving(true);
    setErrors({});
    setErrorMessage("");

    try {
      const response = await fetch(
        initialSkill ? `/api/admin/skills/${initialSkill.id}` : "/api/admin/skills",
        {
          method: initialSkill ? "PATCH" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...values, sortOrder: numericOrder }),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (response.status === 422) setErrors(responseFields(result));
        setErrorMessage(responseError(result, "Unable to save the skill. Please try again."));
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("skill" in result) ||
        typeof result.skill !== "object" ||
        result.skill === null
      ) {
        setErrorMessage("The skill was saved, but the updated details could not be loaded.");
        return;
      }

      onSaved(result.skill as SkillItem);
    } catch {
      setErrorMessage("Unable to save the skill. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="skill-management__editor" variant="outlined">
      <div className="skill-management__editor-heading">
        <div>
          <p className="eyebrow">{initialSkill ? "Edit skill" : "New skill"}</p>
          <h3>{initialSkill ? initialSkill.name : "Add skill details"}</h3>
        </div>
        <Button aria-label="Close skill form" disabled={isSaving} onClick={onCancel} variant="subtle">
          <X aria-hidden="true" size={17} />
          Close
        </Button>
      </div>

      <form aria-busy={isSaving} className="skill-management__form" onSubmit={handleSubmit}>
        <TextInput
          autoComplete="off"
          error={errors.name}
          id="skill-name"
          label="Skill name"
          maxLength={120}
          name="name"
          onChange={(event) => updateField("name", event.target.value)}
          required
          value={values.name}
        />

        <div className="form-field">
          <label className="form-field__label" htmlFor="skill-category">Category</label>
          <select
            aria-describedby={errors.categoryId ? "skill-category-message" : undefined}
            aria-invalid={errors.categoryId ? true : undefined}
            className="form-control"
            id="skill-category"
            name="categoryId"
            onChange={(event) => updateField("categoryId", event.target.value)}
            required
            value={values.categoryId}
          >
            <option value="">Choose a category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          {errors.categoryId ? (
            <span className="form-field__message form-field__message--error" id="skill-category-message">
              {errors.categoryId}
            </span>
          ) : null}
        </div>

        <TextInput
          error={errors.proficiencyLabel}
          hint="Optional label, up to 40 characters. Leave blank if you do not want to show a level."
          id="skill-proficiency"
          label="Proficiency level"
          maxLength={40}
          name="proficiencyLabel"
          onChange={(event) => updateField("proficiencyLabel", event.target.value)}
          value={values.proficiencyLabel}
        />

        <TextArea
          error={errors.description}
          hint="Optional plain text description, up to 2,000 characters."
          id="skill-description"
          label="Description"
          maxLength={2_000}
          name="description"
          onChange={(event) => updateField("description", event.target.value)}
          rows={4}
          value={values.description}
        />

        <div className="skill-management__form-row">
          <div className="form-field">
            <label className="form-field__label" htmlFor="skill-icon">Icon</label>
            <select
              aria-describedby={errors.icon ? "skill-icon-message" : undefined}
              aria-invalid={errors.icon ? true : undefined}
              className="form-control"
              id="skill-icon"
              name="icon"
              onChange={(event) => updateField("icon", event.target.value)}
              value={values.icon}
            >
              <option value="">No icon</option>
              {SKILL_ICON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            {errors.icon ? (
              <span className="form-field__message form-field__message--error" id="skill-icon-message">
                {errors.icon}
              </span>
            ) : null}
          </div>

          <TextInput
            error={errors.sortOrder}
            hint="Lower numbers appear first within the category."
            id="skill-sort-order"
            label="Display order"
            max={999_999}
            min={0}
            name="sortOrder"
            onChange={(event) => updateField("sortOrder", event.target.value)}
            required
            step={1}
            type="number"
            value={values.sortOrder}
          />
        </div>

        <div className="form-field">
          <label className="form-field__label" htmlFor="skill-status">Publication status</label>
          <select
            aria-describedby={errors.status ? "skill-status-message" : undefined}
            aria-invalid={errors.status ? true : undefined}
            className="form-control"
            id="skill-status"
            name="status"
            onChange={(event) => updateField("status", event.target.value)}
            value={values.status}
          >
            <option value="DRAFT">Draft</option>
            <option value="PUBLISHED">Published</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          {errors.status ? (
            <span className="form-field__message form-field__message--error" id="skill-status-message">
              {errors.status}
            </span>
          ) : null}
        </div>

        {errorMessage ? <p className="skill-management__feedback skill-management__feedback--error" role="alert">{errorMessage}</p> : null}

        <div className="skill-management__editor-actions">
          <Button disabled={isSaving} onClick={onCancel} variant="subtle">Cancel</Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="skill-management__spinner" size={17} />
            ) : (
              <Save aria-hidden="true" size={17} />
            )}
            {isSaving ? "Saving…" : "Save skill"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CategoryForm({
  initialCategory,
  onCancel,
  onDirtyChange,
  onSaved,
}: {
  initialCategory: SkillCategoryItem | null;
  onCancel: () => void;
  onDirtyChange: (isDirty: boolean) => void;
  onSaved: (category: SkillCategoryItem) => void;
}) {
  const [initialValues] = useState({
    name: initialCategory?.name ?? "",
    description: initialCategory?.description ?? "",
  });
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const isDirty = hasUnsavedChanges(initialValues, { name, description });
  const [nameError, setNameError] = useState("");
  const [descriptionError, setDescriptionError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = initialCategory !== null;

  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    if (!name.trim()) {
      setNameError("Category name is required.");
      return;
    }

    setIsSaving(true);
    setNameError("");
    setErrorMessage("");

    try {
      const response = await fetch(
        initialCategory
          ? `/api/admin/skills/categories/${initialCategory.id}`
          : "/api/admin/skills/categories",
        {
          method: initialCategory ? "PATCH" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description }),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (result === null) {
          logCategorySaveDiagnostic({
            phase: "non-json-response",
            status: response.status,
            contentType: response.headers.get("content-type"),
          });
        }
        const fields = responseFields(result);
        setNameError(fields.name ?? "");
        setDescriptionError(fields.description ?? "");
        setErrorMessage(
          responseError(
            result,
            `Unable to ${isEditing ? "update" : "create"} the category (HTTP ${response.status}). Please try again.`,
          ),
        );
        return;
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("category" in result) ||
        typeof result.category !== "object" ||
        result.category === null
      ) {
        logCategorySaveDiagnostic({
          phase: "invalid-success-response",
          status: response.status,
          contentType: response.headers.get("content-type"),
        });
        setErrorMessage("The category was saved, but its details could not be loaded.");
        return;
      }
      onSaved(result.category as SkillCategoryItem);
    } catch (error) {
      logCategorySaveDiagnostic({
        phase: "network",
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      setErrorMessage(
        `Unable to ${isEditing ? "update" : "create"} the category. Please try again.`,
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="skill-management__editor" variant="outlined">
      <div className="skill-management__editor-heading">
        <div>
          <p className="eyebrow">Skill category</p>
          <h3>{isEditing ? "Edit category" : "Add a category"}</h3>
        </div>
        <Button aria-label="Close category form" disabled={isSaving} onClick={onCancel} variant="subtle">
          <X aria-hidden="true" size={17} />
          Close
        </Button>
      </div>

      <form aria-busy={isSaving} className="skill-management__form" onSubmit={handleSubmit}>
        <TextInput
          autoComplete="off"
          error={nameError}
          hint="The URL slug is generated from the category name."
          id="skill-category-name"
          label="Category name"
          maxLength={100}
          name="name"
          onChange={(event) => {
            setName(event.target.value);
            setNameError("");
            setErrorMessage("");
          }}
          required
          value={name}
        />
        <TextArea
          error={descriptionError}
          hint="Optional. Up to 500 characters."
          id="skill-category-description"
          label="Description"
          maxLength={500}
          name="description"
          onChange={(event) => {
            setDescription(event.target.value);
            setDescriptionError("");
            setErrorMessage("");
          }}
          rows={3}
          value={description}
        />

        {errorMessage ? <p className="skill-management__feedback skill-management__feedback--error" role="alert">{errorMessage}</p> : null}
        <div className="skill-management__editor-actions">
          <Button disabled={isSaving} onClick={onCancel} variant="subtle">Cancel</Button>
          <Button disabled={isSaving} type="submit">
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="skill-management__spinner" size={17} />
            ) : (
              isEditing ? <Save aria-hidden="true" size={17} /> : <FolderPlus aria-hidden="true" size={17} />
            )}
            {isSaving ? "Saving…" : isEditing ? "Save changes" : "Save category"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
