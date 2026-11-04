"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ContentStatus, EmploymentType } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextArea, TextInput } from "@/components/ui/form-field";
import { useAdminUnsavedNavigationProtection } from "@/components/admin/admin-unsaved-navigation-guard";
import {
  createEmptyWorkExperienceFormValues,
  deleteWorkExperienceRecord,
  loadWorkExperienceRecords,
  runWorkExperienceRequestOnce,
  saveWorkExperienceRecord,
  setCurrentEmployment,
  workExperienceSaveEditorTransition,
  validateWorkExperienceForm,
  workExperienceToFormValues,
  type AdminWorkExperienceItem,
  type WorkExperienceFormFieldErrors,
  type WorkExperienceFormValues,
  type WorkExperienceRequestResult,
} from "@/lib/work-experience-form";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";
import { WORK_EXPERIENCE_EMPLOYMENT_TYPE_LABELS, workExperienceEmploymentTypeLabel } from "@/lib/work-experience-validation";

interface WorkExperienceEditor {
  item: AdminWorkExperienceItem | null;
  initialValues: WorkExperienceFormValues;
  values: WorkExperienceFormValues;
}

function statusLabel(status: ContentStatus): string {
  switch (status) {
    case "PUBLISHED": return "Published";
    case "ARCHIVED": return "Archived";
    default: return "Draft";
  }
}

function dateLabel(value: string | null): string {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function WorkExperienceManager() {
  const [items, setItems] = useState<AdminWorkExperienceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editor, setEditor] = useState<WorkExperienceEditor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<WorkExperienceFormFieldErrors>({});
  const [pendingDelete, setPendingDelete] = useState<AdminWorkExperienceItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const editorIsDirty = Boolean(
    editor && hasUnsavedChanges(editor.initialValues, editor.values),
  );
  useAdminUnsavedNavigationProtection(editorIsDirty);

  const refreshRecords = useCallback(async (initialLoad = false) => {
    if (initialLoad) setIsLoading(true);
    else setIsRefreshing(true);

    const result = await loadWorkExperienceRecords();
    if (result.ok) {
      setItems(result.value);
      setPageError("");
      setSessionExpired(false);
    } else {
      setPageError(result.error);
      setSessionExpired(Boolean(result.unauthorized));
    }

    setIsLoading(false);
    setIsRefreshing(false);
    return result.ok;
  }, []);

  useEffect(() => {
    let isActive = true;

    void loadWorkExperienceRecords().then((result) => {
      if (!isActive) return;
      if (result.ok) {
        setItems(result.value);
      } else {
        setPageError(result.error);
        setSessionExpired(Boolean(result.unauthorized));
      }
      setIsLoading(false);
    });

    return () => {
      isActive = false;
    };
  }, []);

  function openEditor(item: AdminWorkExperienceItem | null) {
    const values = item
      ? workExperienceToFormValues(item)
      : createEmptyWorkExperienceFormValues();
    setEditor({ item, initialValues: values, values });
    setFieldErrors({});
    setPageError("");
    setPageSuccess("");
  }

  function closeEditor() {
    if (savingRef.current) return;
    if (!confirmDiscardIfDirty(editorIsDirty)) return;
    setEditor(null);
    setFieldErrors({});
  }

  function updateEditorValue<K extends keyof WorkExperienceFormValues>(
    field: K,
    value: WorkExperienceFormValues[K],
  ) {
    setEditor((current) => current ? {
      ...current,
      values: { ...current.values, [field]: value },
    } : current);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setPageError("");
    setPageSuccess("");
  }

  function updateCurrentEmployment(currentPosition: boolean) {
    setEditor((current) => current ? {
      ...current,
      values: setCurrentEmployment(current.values, currentPosition),
    } : current);
    setFieldErrors((current) => ({ ...current, currentPosition: undefined, endDate: undefined }));
    setPageError("");
    setPageSuccess("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || savingRef.current) return;

    setPageSuccess("");
    const localErrors = validateWorkExperienceForm(editor.values);
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setPageError("Please correct the highlighted fields.");
      return;
    }

    setSaving(true);
    setPageError("");
    const submittedEditor = editor;
    let result: WorkExperienceRequestResult<AdminWorkExperienceItem>;
    try {
      const request = await runWorkExperienceRequestOnce(savingRef, () =>
        saveWorkExperienceRecord(
          submittedEditor.item?.id ?? null,
          submittedEditor.values,
          fetch,
          submittedEditor.item?.version,
        ),
      );
      if (!request.started) return;
      result = request.value;
    } catch {
      setPageError("Unable to save work experience. Check your connection and try again.");
      setSessionExpired(false);
      return;
    } finally {
      setSaving(false);
    }

    const operation = submittedEditor.item === null ? "create" : "update";
    if (!result.ok) {
      const transition = workExperienceSaveEditorTransition(submittedEditor, result, operation);
      setFieldErrors(result.fields ?? {});
      setPageError(result.error);
      setPageSuccess(transition.successMessage);
      setSessionExpired(Boolean(result.unauthorized));
      return;
    }

    const transition = workExperienceSaveEditorTransition(submittedEditor, result, operation);
    setEditor(transition.editor);
    setFieldErrors({});
    setPageSuccess(transition.successMessage);
    await refreshRecords();
  }

  function requestDelete(item: AdminWorkExperienceItem) {
    setPendingDelete(item);
    setDeleteError("");
    setPageError("");
    setPageSuccess("");
  }

  function closeDeleteConfirmation() {
    if (deletingRef.current) return;
    setPendingDelete(null);
    setDeleteError("");
  }

  async function confirmDelete() {
    if (!pendingDelete || deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError("");
    const result = await deleteWorkExperienceRecord(pendingDelete.id, pendingDelete.version, true);
    deletingRef.current = false;
    setDeleting(false);

    if (!result.ok) {
      setDeleteError(result.error);
      setSessionExpired(Boolean(result.unauthorized));
      return;
    }

    setPendingDelete(null);
    setPageSuccess("Work experience was deleted.");
    await refreshRecords();
  }

  return (
    <section aria-labelledby="experience-management-heading" className="experience-management">
      <div className="experience-management__toolbar">
        <div>
          <p className="eyebrow">Employment history</p>
          <h2 id="experience-management-heading">Work experience records</h2>
          <p>Only enter accurate employment details. Draft and archived records remain private.</p>
        </div>
        <Button onClick={() => openEditor(null)}>
          <Plus aria-hidden="true" size={17} />
          Add experience
        </Button>
      </div>

      {pageSuccess && !editor ? <p className="experience-management__feedback experience-management__feedback--success" role="status" aria-live="polite">{pageSuccess}</p> : null}
      {pageError && !editor && items.length > 0 ? (
        <div className="experience-management__feedback experience-management__feedback--error" role="alert">
          <span>{pageError}</span>
          {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
        </div>
      ) : null}

      {isLoading ? (
        <Card aria-busy="true" className="experience-management__loading" variant="outlined" role="status">
          <LoaderCircle aria-hidden="true" className="experience-management__spinner" size={18} />
          <span>Loading work experience…</span>
        </Card>
      ) : pageError && items.length === 0 ? (
        <Card className="experience-management__load-error" variant="outlined">
          <h3>Work experience is unavailable</h3>
          <p>Try loading the records again. No content was changed.</p>
          {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
          <Button disabled={isRefreshing} onClick={() => void refreshRecords(true)} variant="secondary">
            {isRefreshing ? "Loading…" : "Try again"}
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BriefcaseBusiness size={22} />}
          eyebrow="NO RECORDS YET"
          title="No work experience records"
          description="Create a record when you are ready to manage confirmed employment information."
          action={<Button onClick={() => openEditor(null)}><Plus aria-hidden="true" size={17} />Add experience</Button>}
        />
      ) : (
        <>
          <p className="experience-management__count" aria-live="polite">
            {items.length} {items.length === 1 ? "record" : "records"}
            {isRefreshing ? <span> · Updating list…</span> : null}
          </p>
          <div className="experience-management__list">
            {items.map((item) => (
              <Card className="experience-management__item" key={item.id} variant="outlined">
                <div className="experience-management__item-main">
                  <div className="experience-management__item-heading">
                    <h3>{item.roleTitle}</h3>
                    <span className={`experience-management__status experience-management__status--${item.status.toLowerCase()}`}>
                      {statusLabel(item.status)}
                    </span>
                    {item.currentPosition ? <span className="experience-management__current">Current</span> : null}
                  </div>
                  <p className="experience-management__employer">{item.employer}</p>
                  <div className="experience-management__meta">
                    <span className="experience-management__employment-type">{workExperienceEmploymentTypeLabel(item.employmentType)}</span>
                    {item.location ? <span><MapPin aria-hidden="true" size={14} />{item.location}</span> : null}
                    <span>
                      <CalendarDays aria-hidden="true" size={14} />
                      {dateLabel(item.startDate)} – {item.currentPosition ? "Present" : dateLabel(item.endDate)}
                    </span>
                    <span>Order {item.sortOrder}</span>
                  </div>
                  {item.description ? <p className="experience-management__description">{item.description}</p> : null}
                </div>
                <div className="experience-management__actions" aria-label={`${item.roleTitle} actions`}>
                  <Button
                    aria-label={`Edit ${item.roleTitle} at ${item.employer}`}
                    onClick={() => openEditor(item)}
                    size="small"
                    variant="secondary"
                  >
                    <Pencil aria-hidden="true" size={15} />Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${item.roleTitle} at ${item.employer}`}
                    onClick={() => requestDelete(item)}
                    size="small"
                    variant="subtle"
                  >
                    <Trash2 aria-hidden="true" size={15} />Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {editor && (
        <Dialog
          open={true}
          onClose={closeEditor}
          title={editor?.item ? "Edit work experience" : "Add work experience"}
          description="Company name, role title, and start date are required. Add an end date unless this is a current role."
        >
        {editor ? (
          <form aria-busy={saving} className="experience-management__form" noValidate onSubmit={handleSubmit}>
            <div className="experience-management__form-grid">
              <TextInput
                autoComplete="organization"
                error={fieldErrors.employer}
                id="experience-employer"
                label="Company name"
                maxLength={200}
                onChange={(event) => updateEditorValue("employer", event.currentTarget.value)}
                required
                value={editor.values.employer}
              />
              <TextInput
                error={fieldErrors.roleTitle}
                id="experience-role-title"
                label="Role title"
                maxLength={160}
                onChange={(event) => updateEditorValue("roleTitle", event.currentTarget.value)}
                required
                value={editor.values.roleTitle}
              />
              <label className="experience-management__field" htmlFor="experience-employment-type">
                <span className="experience-management__field-label">Employment type</span>
                <select
                  aria-describedby={fieldErrors.employmentType ? "experience-employment-type-error" : undefined}
                  aria-invalid={fieldErrors.employmentType ? true : undefined}
                  className="form-control"
                  id="experience-employment-type"
                  onChange={(event) => updateEditorValue("employmentType", event.currentTarget.value as EmploymentType | "")}
                  required
                  value={editor.values.employmentType}
                >
                  <option disabled value="">Choose employment type</option>
                  {Object.entries(WORK_EXPERIENCE_EMPLOYMENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                {fieldErrors.employmentType ? <span className="experience-management__field-error" id="experience-employment-type-error">{fieldErrors.employmentType}</span> : null}
              </label>
              <TextInput
                autoComplete="address-level2"
                error={fieldErrors.location}
                id="experience-location"
                label="Location"
                maxLength={160}
                onChange={(event) => updateEditorValue("location", event.currentTarget.value)}
                value={editor.values.location}
              />
              <TextInput
                error={fieldErrors.startDate}
                id="experience-start-date"
                label="Start date"
                onChange={(event) => updateEditorValue("startDate", event.currentTarget.value)}
                required
                type="date"
                value={editor.values.startDate}
              />
              <TextInput
                disabled={editor.values.currentPosition}
                error={fieldErrors.endDate}
                id="experience-end-date"
                label="End date"
                onChange={(event) => updateEditorValue("endDate", event.currentTarget.value)}
                required={!editor.values.currentPosition}
                type="date"
                value={editor.values.endDate}
              />
              <label
                className="experience-management__checkbox"
                htmlFor="experience-current-position"
              >
                <input
                  aria-describedby={fieldErrors.currentPosition ? "experience-current-position-error" : undefined}
                  aria-invalid={fieldErrors.currentPosition ? true : undefined}
                  checked={editor.values.currentPosition}
                  id="experience-current-position"
                  onChange={(event) => updateCurrentEmployment(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>I currently work here</span>
                {fieldErrors.currentPosition ? <span className="experience-management__field-error" id="experience-current-position-error">{fieldErrors.currentPosition}</span> : null}
              </label>
              <label className="experience-management__field" htmlFor="experience-status">
                <span className="experience-management__field-label">Status</span>
                <select
                  aria-describedby={fieldErrors.status ? "experience-status-error" : undefined}
                  aria-invalid={fieldErrors.status ? true : undefined}
                  className="form-control"
                  id="experience-status"
                  onChange={(event) => updateEditorValue("status", event.currentTarget.value as ContentStatus)}
                  value={editor.values.status}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                {fieldErrors.status ? <span className="experience-management__field-error" id="experience-status-error">{fieldErrors.status}</span> : null}
              </label>
              <TextInput
                error={fieldErrors.sortOrder}
                id="experience-sort-order"
                label="Display order"
                max={999999}
                min={0}
                onChange={(event) => updateEditorValue("sortOrder", event.currentTarget.value)}
                required
                step={1}
                type="number"
                value={editor.values.sortOrder}
              />
            </div>
            <TextArea
              error={fieldErrors.description}
              id="experience-description"
              label="Description"
              maxLength={10000}
              onChange={(event) => updateEditorValue("description", event.currentTarget.value)}
              rows={5}
              value={editor.values.description}
            />
            {pageError ? (
              <div className="experience-management__form-error" role="alert">
                <p>{pageError}</p>
                {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
              </div>
            ) : null}
            <div className="experience-management__form-actions">
              <Button disabled={saving} onClick={closeEditor} variant="secondary">Cancel</Button>
              <Button disabled={saving} type="submit">
                {saving ? <LoaderCircle aria-hidden="true" className="experience-management__spinner" size={16} /> : null}
                {saving ? "Saving…" : "Save experience"}
              </Button>
            </div>
          </form>
        ) : null}
        </Dialog>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={closeDeleteConfirmation}
        title="Delete work experience?"
        description="This action permanently removes this record. It cannot be undone."
      >
        {pendingDelete ? (
          <div className="experience-management__delete-confirm">
            <p>
              Delete <strong>{pendingDelete.roleTitle}</strong> at <strong>{pendingDelete.employer}</strong>?
            </p>
            {deleteError ? (
              <div className="experience-management__form-error" role="alert">
                <p>{deleteError}</p>
                {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
              </div>
            ) : null}
            <div className="experience-management__form-actions">
              <Button disabled={deleting} onClick={closeDeleteConfirmation} variant="secondary">Cancel</Button>
              <Button disabled={deleting} onClick={() => void confirmDelete()} variant="primary">
                {deleting ? <LoaderCircle aria-hidden="true" className="experience-management__spinner" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
                {deleting ? "Deleting…" : "Delete record"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
