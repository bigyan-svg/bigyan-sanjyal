"use client";

import {
  BookOpenText,
  CalendarDays,
  GraduationCap,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ContentStatus } from "@/generated/prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextArea, TextInput } from "@/components/ui/form-field";
import {
  createEmptyEducationFormValues,
  deleteEducationRecord,
  educationToFormValues,
  loadEducationRecords,
  runEducationRequestOnce,
  saveEducationRecord,
  setCurrentEducation,
  validateEducationForm,
  type AdminEducationItem,
  type EducationFormFieldErrors,
  type EducationFormValues,
} from "@/lib/education-form";
import { confirmDiscardIfDirty, hasUnsavedChanges } from "@/lib/unsaved-changes";

interface EducationEditor {
  item: AdminEducationItem | null;
  initialValues: EducationFormValues;
  values: EducationFormValues;
}

function statusLabel(status: ContentStatus): string {
  switch (status) {
    case "PUBLISHED": return "Published";
    case "ARCHIVED": return "Archived";
    default: return "Draft";
  }
}

function formatDate(value: string | null): string | null {
  if (!value || !Number.isFinite(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function dateRange(item: AdminEducationItem): string {
  const start = formatDate(item.startDate);
  const end = item.isCurrent ? "Present" : formatDate(item.endDate);
  if (!start && !end) return "Dates not set";
  return `${start ?? "Date not set"} – ${end ?? "End date not set"}`;
}

export function EducationManager() {
  const [items, setItems] = useState<AdminEducationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editor, setEditor] = useState<EducationEditor | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EducationFormFieldErrors>({});
  const [pendingDelete, setPendingDelete] = useState<AdminEducationItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  const editorIsDirty = Boolean(editor && hasUnsavedChanges(editor.initialValues, editor.values));

  const refreshRecords = useCallback(async (initialLoad = false) => {
    if (initialLoad) setIsLoading(true);
    else setIsRefreshing(true);

    const result = await loadEducationRecords();
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
    let active = true;
    void loadEducationRecords().then((result) => {
      if (!active) return;
      if (result.ok) {
        setItems(result.value);
      } else {
        setPageError(result.error);
        setSessionExpired(Boolean(result.unauthorized));
      }
      setIsLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!editorIsDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey
      ) return;
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
  }, [editorIsDirty]);

  function openEditor(item: AdminEducationItem | null) {
    const values = item
      ? educationToFormValues(item)
      : createEmptyEducationFormValues(items.length);
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

  function updateEditorValue<K extends keyof EducationFormValues>(
    field: K,
    value: EducationFormValues[K],
  ) {
    setEditor((current) => current ? {
      ...current,
      values: { ...current.values, [field]: value },
    } : current);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setPageError("");
  }

  function updateCurrent(isCurrent: boolean) {
    setEditor((current) => current ? {
      ...current,
      values: setCurrentEducation(current.values, isCurrent),
    } : current);
    setFieldErrors((current) => ({ ...current, isCurrent: undefined, endDate: undefined }));
    setPageError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    const localErrors = validateEducationForm(editor.values);
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setPageError("Please correct the highlighted fields.");
      return;
    }

    const submittedEditor = editor;
    const attempt = await runEducationRequestOnce(savingRef, async () => {
      setSaving(true);
      setPageError("");
      setPageSuccess("");
      try {
        return await saveEducationRecord(submittedEditor.item?.id ?? null, submittedEditor.values);
      } finally {
        setSaving(false);
      }
    });
    if (!attempt.started) return;

    const result = attempt.value;
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      setPageError(result.error);
      setSessionExpired(Boolean(result.unauthorized));
      return;
    }

    const isNew = submittedEditor.item === null;
    setEditor(null);
    setFieldErrors({});
    setPageSuccess(isNew ? "Education record was created." : "Education record was updated.");
    await refreshRecords();
  }

  function requestDelete(item: AdminEducationItem) {
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
    const result = await deleteEducationRecord(pendingDelete.id, true);
    deletingRef.current = false;
    setDeleting(false);

    if (!result.ok) {
      setDeleteError(result.error);
      setSessionExpired(Boolean(result.unauthorized));
      return;
    }

    setPendingDelete(null);
    setPageSuccess("Education record was deleted.");
    await refreshRecords();
  }

  return (
    <section aria-labelledby="education-management-heading" className="education-management">
      <div className="education-management__toolbar">
        <div>
          <p className="eyebrow">Academic history</p>
          <h2 id="education-management-heading">Education records</h2>
          <p>Manage academic details and choose which records are published.</p>
        </div>
        <Button onClick={() => openEditor(null)}>
          <Plus aria-hidden="true" size={17} />Add education
        </Button>
      </div>

      {pageSuccess ? (
        <p className="education-management__feedback education-management__feedback--success" role="status" aria-live="polite">
          {pageSuccess}
        </p>
      ) : null}
      {pageError && !editor && items.length > 0 ? (
        <div className="education-management__feedback education-management__feedback--error" role="alert">
          <span>{pageError}</span>
          {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
        </div>
      ) : null}

      {isLoading ? (
        <Card aria-busy="true" className="education-management__loading" variant="outlined" role="status">
          <LoaderCircle aria-hidden="true" className="education-management__spinner" size={18} />
          <span>Loading education records…</span>
        </Card>
      ) : pageError && items.length === 0 ? (
        <Card className="education-management__load-error" variant="outlined">
          <h3>Education records are unavailable</h3>
          <p>Try loading the records again. No content was changed.</p>
          {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
          <Button disabled={isRefreshing} onClick={() => void refreshRecords(true)} variant="secondary">
            {isRefreshing ? "Loading…" : "Try again"}
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={22} />}
          eyebrow="NO RECORDS YET"
          title="No education records"
          description="Add an education record when you are ready. No academic details have been prefilled."
          action={<Button onClick={() => openEditor(null)}><Plus aria-hidden="true" size={17} />Add education</Button>}
        />
      ) : (
        <>
          <p className="education-management__count" aria-live="polite">
            {items.length} {items.length === 1 ? "record" : "records"}
            {isRefreshing ? <span> · Updating list…</span> : null}
          </p>
          <div className="education-management__list">
            {items.map((item) => (
              <Card className="education-management__item" key={item.id} variant="outlined">
                <div className="education-management__item-main">
                  <div className="education-management__item-heading">
                    <h3>{item.program}</h3>
                    <span className={`education-management__status education-management__status--${item.status.toLowerCase()}`}>
                      {statusLabel(item.status)}
                    </span>
                    {item.isCurrent ? <span className="education-management__current">Current</span> : null}
                  </div>
                  <p className="education-management__institution">{item.institution}</p>
                  <div className="education-management__meta">
                    {item.fieldOfStudy ? (
                      <span><BookOpenText aria-hidden="true" size={14} />{item.fieldOfStudy}</span>
                    ) : null}
                    <span><CalendarDays aria-hidden="true" size={14} />{dateRange(item)}</span>
                    <span>Order {item.sortOrder}</span>
                  </div>
                  {item.description ? <p className="education-management__description">{item.description}</p> : null}
                </div>
                <div className="education-management__actions" aria-label={`${item.program} actions`}>
                  <Button
                    aria-label={`Edit ${item.program} at ${item.institution}`}
                    onClick={() => openEditor(item)}
                    size="small"
                    variant="secondary"
                  >
                    <Pencil aria-hidden="true" size={15} />Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${item.program} at ${item.institution}`}
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

      <Dialog
        open={editor !== null}
        onClose={closeEditor}
        title={editor?.item ? "Edit education" : "Add education"}
        description="Institution and program are required. Dates are optional; current education has no end date."
      >
        {editor ? (
          <form aria-busy={saving} className="education-management__form" noValidate onSubmit={handleSubmit}>
            <div className="education-management__form-grid">
              <TextInput
                autoComplete="organization"
                error={fieldErrors.institution}
                id="education-institution"
                label="Institution"
                maxLength={200}
                onChange={(event) => updateEditorValue("institution", event.currentTarget.value)}
                required
                value={editor.values.institution}
              />
              <TextInput
                error={fieldErrors.program}
                id="education-program"
                label="Program"
                maxLength={200}
                onChange={(event) => updateEditorValue("program", event.currentTarget.value)}
                required
                value={editor.values.program}
              />
              <TextInput
                error={fieldErrors.fieldOfStudy}
                id="education-field-of-study"
                label="Field of study"
                maxLength={200}
                onChange={(event) => updateEditorValue("fieldOfStudy", event.currentTarget.value)}
                value={editor.values.fieldOfStudy}
              />
              <TextInput
                error={fieldErrors.startDate}
                id="education-start-date"
                label="Start date"
                onChange={(event) => updateEditorValue("startDate", event.currentTarget.value)}
                type="date"
                value={editor.values.startDate}
              />
              <TextInput
                disabled={editor.values.isCurrent}
                error={fieldErrors.endDate}
                id="education-end-date"
                label="End date"
                onChange={(event) => updateEditorValue("endDate", event.currentTarget.value)}
                type="date"
                value={editor.values.endDate}
              />
              <label className="education-management__checkbox" htmlFor="education-current">
                <input
                  aria-describedby={fieldErrors.isCurrent ? "education-current-error" : undefined}
                  aria-invalid={fieldErrors.isCurrent ? true : undefined}
                  checked={editor.values.isCurrent}
                  id="education-current"
                  onChange={(event) => updateCurrent(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>This is current education</span>
                {fieldErrors.isCurrent ? (
                  <span className="education-management__field-error" id="education-current-error">
                    {fieldErrors.isCurrent}
                  </span>
                ) : null}
              </label>
              <label className="education-management__field" htmlFor="education-status">
                <span className="education-management__field-label">Publication status</span>
                <select
                  aria-describedby={fieldErrors.status ? "education-status-error" : undefined}
                  aria-invalid={fieldErrors.status ? true : undefined}
                  className="form-control"
                  id="education-status"
                  onChange={(event) => updateEditorValue("status", event.currentTarget.value as ContentStatus)}
                  value={editor.values.status}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                {fieldErrors.status ? (
                  <span className="education-management__field-error" id="education-status-error">
                    {fieldErrors.status}
                  </span>
                ) : null}
              </label>
              <TextInput
                error={fieldErrors.sortOrder}
                id="education-sort-order"
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
              id="education-description"
              label="Description"
              maxLength={10000}
              onChange={(event) => updateEditorValue("description", event.currentTarget.value)}
              rows={5}
              value={editor.values.description}
            />
            {pageError ? (
              <div className="education-management__form-error" role="alert">
                <p>{pageError}</p>
                {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
              </div>
            ) : null}
            <div className="education-management__form-actions">
              <Button disabled={saving} onClick={closeEditor} variant="secondary">Cancel</Button>
              <Button disabled={saving} type="submit">
                {saving ? <LoaderCircle aria-hidden="true" className="education-management__spinner" size={16} /> : null}
                {saving ? "Saving…" : "Save education"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        onClose={closeDeleteConfirmation}
        title="Delete education record?"
        description="This action permanently removes this record. It cannot be undone."
      >
        {pendingDelete ? (
          <div className="education-management__delete-confirm">
            <p>
              Delete <strong>{pendingDelete.program}</strong> at <strong>{pendingDelete.institution}</strong>?
            </p>
            {deleteError ? (
              <div className="education-management__form-error" role="alert">
                <p>{deleteError}</p>
                {sessionExpired ? <Link href="/admin/login">Sign in again</Link> : null}
              </div>
            ) : null}
            <div className="education-management__form-actions">
              <Button disabled={deleting} onClick={closeDeleteConfirmation} variant="secondary">Cancel</Button>
              <Button disabled={deleting} onClick={() => void confirmDelete()} variant="primary">
                {deleting ? <LoaderCircle aria-hidden="true" className="education-management__spinner" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
                {deleting ? "Deleting…" : "Delete record"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
