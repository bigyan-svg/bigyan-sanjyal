"use client";

import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { TextInput } from "@/components/ui/form-field";
import {
  createEmptySocialLinkFormValues,
  hasSocialLinkUnsavedChanges,
  socialLinkToFormValues,
  type SocialLinkFormValues,
} from "@/lib/profile-social-form";
import {
  parseCreateSocialLink,
  type AdminSocialLink,
  type SocialLinkFieldErrors,
} from "@/lib/profile-social-validation";
import { confirmDiscardIfDirty } from "@/lib/unsaved-changes";

interface SocialLinkEditor {
  link: AdminSocialLink | null;
  initialValues: SocialLinkFormValues;
  values: SocialLinkFormValues;
}

interface SocialLinksManagerProps {
  onUnsavedChangesChange(isDirty: boolean): void;
}

function isAdminSocialLink(value: unknown): value is AdminSocialLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  return (
    typeof link.id === "string" &&
    typeof link.label === "string" &&
    typeof link.url === "string" &&
    typeof link.sortOrder === "number"
  );
}

function responseError(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return fallback;
}

function responseFieldErrors(value: unknown): SocialLinkFieldErrors {
  if (typeof value !== "object" || value === null || !("fields" in value)) return {};
  const fields = value.fields;
  if (typeof fields !== "object" || fields === null) return {};

  const fieldErrors: SocialLinkFieldErrors = {};
  if ("label" in fields && typeof fields.label === "string") fieldErrors.label = fields.label;
  if ("url" in fields && typeof fields.url === "string") fieldErrors.url = fields.url;
  return fieldErrors;
}

type SocialLinksLoadResult =
  | { links: AdminSocialLink[]; error: null; unauthorized: false }
  | { links: null; error: string; unauthorized: boolean };

async function requestSocialLinks(): Promise<SocialLinksLoadResult> {
  try {
    const response = await fetch("/api/admin/profile/social-links", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    const result: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        links: null,
        error: responseError(result, "Unable to load social links. Please try again."),
        unauthorized: response.status === 401,
      };
    }

    if (
      typeof result !== "object" ||
      result === null ||
      !("links" in result) ||
      !Array.isArray(result.links) ||
      !result.links.every(isAdminSocialLink)
    ) {
      return {
        links: null,
        error: "Unable to load social links. Please try again.",
        unauthorized: false,
      };
    }

    return { links: result.links, error: null, unauthorized: false };
  } catch {
    return {
      links: null,
      error: "Unable to load social links. Check your connection and try again.",
      unauthorized: false,
    };
  }
}

export function SocialLinksManager({ onUnsavedChangesChange }: SocialLinksManagerProps) {
  const [links, setLinks] = useState<AdminSocialLink[]>([]);
  const [editor, setEditor] = useState<SocialLinkEditor | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminSocialLink | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SocialLinkFieldErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false);
  const editorIsDirty = Boolean(
    editor && hasSocialLinkUnsavedChanges(editor.initialValues, editor.values),
  );

  useEffect(() => {
    onUnsavedChangesChange(editorIsDirty);
  }, [editorIsDirty, onUnsavedChangesChange]);

  const loadLinks = useCallback(async (): Promise<boolean> => {
    setIsRefreshing(true);
    setPageError("");
    try {
      const result = await requestSocialLinks();
      if (!result.links) {
        setPageError(result.error);
        setSessionExpired(result.unauthorized);
        setLoadFailed(true);
        return false;
      }
      setLinks(result.links);
      setSessionExpired(false);
      setLoadFailed(false);
      return true;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void requestSocialLinks().then((result) => {
      if (!active) return;
      setIsLoading(false);
      if (!result.links) {
        setPageError(result.error);
        setSessionExpired(result.unauthorized);
        setLoadFailed(true);
        return;
      }
      setLinks(result.links);
      setSessionExpired(false);
      setLoadFailed(false);
    });
    return () => {
      active = false;
    };
  }, []);

  function openEditor(link: AdminSocialLink | null) {
    const values = link ? socialLinkToFormValues(link) : createEmptySocialLinkFormValues();
    setEditor({ link, initialValues: values, values });
    setFieldErrors({});
    setPageError("");
    setPageSuccess("");
  }

  function closeEditor() {
    if (savingRef.current || !confirmDiscardIfDirty(editorIsDirty)) return;
    setEditor(null);
    setFieldErrors({});
  }

  function updateField(field: keyof SocialLinkFormValues, value: string) {
    setEditor((current) => current ? {
      ...current,
      values: { ...current.values, [field]: value },
    } : current);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setPageError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || savingRef.current) return;

    const parsed = parseCreateSocialLink(editor.values);
    if (!parsed.data) {
      setFieldErrors(parsed.errors);
      setPageError("Please correct the highlighted fields.");
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setFieldErrors({});
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch(
        editor.link
          ? `/api/admin/profile/social-links/${encodeURIComponent(editor.link.id)}`
          : "/api/admin/profile/social-links",
        {
          method: editor.link ? "PATCH" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const result: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setFieldErrors(responseFieldErrors(result));
        setPageError(responseError(result, "Unable to save the social link. Please try again."));
        setSessionExpired(response.status === 401);
        return;
      }

      if (
        typeof result !== "object" || result === null ||
        !("link" in result) || !isAdminSocialLink(result.link)
      ) {
        setPageError("The link was saved, but the updated values could not be loaded.");
        return;
      }

      const wasNew = editor.link === null;
      setEditor(null);
      setPageSuccess(wasNew ? "Social link added." : "Social link updated.");
      await loadLinks();
    } catch {
      setPageError("Unable to save the social link. Check your connection and try again.");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function reorderLinks(link: AdminSocialLink, direction: -1 | 1) {
    if (isReordering) return;
    const currentIndex = links.findIndex((item) => item.id === link.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= links.length) return;

    const orderedLinks = [...links];
    [orderedLinks[currentIndex], orderedLinks[targetIndex]] = [
      orderedLinks[targetIndex],
      orderedLinks[currentIndex],
    ];
    setIsReordering(true);
    setPageError("");
    setPageSuccess("");

    try {
      const response = await fetch("/api/admin/profile/social-links", {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: orderedLinks.map((item) => item.id) }),
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setPageError(responseError(result, "Unable to reorder social links. Please try again."));
        setSessionExpired(response.status === 401);
        if (response.status === 409) void loadLinks();
        return;
      }

      setLinks(orderedLinks.map((item, sortOrder) => ({ ...item, sortOrder })));
      setPageSuccess("Social links reordered.");
    } catch {
      setPageError("Unable to reorder social links. Check your connection and try again.");
    } finally {
      setIsReordering(false);
    }
  }

  async function deleteLink() {
    if (!pendingDelete || deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    setDeleteError("");

    try {
      const response = await fetch(
        `/api/admin/profile/social-links/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE", credentials: "same-origin", cache: "no-store" },
      );
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(responseError(result, "Unable to delete the social link. Please try again."));
        setSessionExpired(response.status === 401);
        return;
      }

      setLinks((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      setPageSuccess("Social link deleted.");
      setPageError("");
      await loadLinks();
    } catch {
      setDeleteError("Unable to delete the social link. Check your connection and try again.");
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Card className="profile-social__card" variant="outlined">
        <header className="profile-social__header">
          <div>
            <p className="eyebrow">Public profile</p>
            <h2>Social links</h2>
            <p className="profile-social__description">
              Add and order the external profiles you want visitors to see.
            </p>
          </div>
          <Button disabled={isLoading || isReordering} onClick={() => openEditor(null)}>
            <Plus aria-hidden="true" size={17} />
            Add link
          </Button>
        </header>

        <div aria-live="polite" className="profile-management__feedback">
          {pageSuccess ? <p className="profile-management__success" role="status">{pageSuccess}</p> : null}
          {pageError && (!loadFailed || links.length > 0) ? (
            <p className="profile-management__error" role="alert">{pageError}</p>
          ) : null}
        </div>

        {sessionExpired ? (
          <p className="profile-social__session-note">
            Your admin session may have expired. Sign in again to continue managing links.
          </p>
        ) : null}

        {isLoading ? (
          <p aria-live="polite" className="profile-social__loading" role="status">
            <LoaderCircle aria-hidden="true" className="profile-management__spinner" size={17} />
            Loading social links…
          </p>
        ) : loadFailed && links.length === 0 ? (
          <div className="profile-social__load-error" role="alert">
            <p>Social links could not be loaded.</p>
            <Button disabled={isRefreshing} onClick={() => void loadLinks()} variant="secondary">
              {isRefreshing ? "Loading…" : "Try again"}
            </Button>
          </div>
        ) : links.length === 0 ? (
          <EmptyState
            description="Add a link only when you are ready to share that profile publicly."
            icon={<Link2 size={20} />}
            title="No social links yet"
          />
        ) : (
          <ol aria-label="Social links, ordered for public display" className="profile-social__list">
            {links.map((link, index) => (
              <li className="profile-social__item" key={link.id}>
                <div className="profile-social__identity">
                  <span aria-hidden="true" className="profile-social__order">{index + 1}</span>
                  <div className="profile-social__copy">
                    <strong>{link.label}</strong>
                    <a
                      href={link.url}
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      target="_blank"
                    >
                      <span>{link.url}</span>
                      <ExternalLink aria-hidden="true" size={13} />
                      <span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  </div>
                </div>
                <div aria-label={`Actions for ${link.label}`} className="profile-social__actions">
                  <Button
                    aria-label={`Move ${link.label} up`}
                    disabled={isReordering || index === 0}
                    onClick={() => void reorderLinks(link, -1)}
                    size="small"
                    variant="subtle"
                  >
                    <ArrowUp aria-hidden="true" size={15} />
                  </Button>
                  <Button
                    aria-label={`Move ${link.label} down`}
                    disabled={isReordering || index === links.length - 1}
                    onClick={() => void reorderLinks(link, 1)}
                    size="small"
                    variant="subtle"
                  >
                    <ArrowDown aria-hidden="true" size={15} />
                  </Button>
                  <Button
                    aria-label={`Edit ${link.label}`}
                    disabled={isReordering}
                    onClick={() => openEditor(link)}
                    size="small"
                    variant="secondary"
                  >
                    <Pencil aria-hidden="true" size={15} />
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${link.label}`}
                    disabled={isReordering}
                    onClick={() => {
                      setPendingDelete(link);
                      setDeleteError("");
                    }}
                    size="small"
                    variant="subtle"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Dialog
        description="Only HTTPS links without embedded credentials can be published."
        onClose={closeEditor}
        open={editor !== null}
        title={editor?.link ? "Edit social link" : "Add social link"}
      >
        {editor ? (
          <form className="profile-social__form" onSubmit={handleSubmit}>
            <TextInput
              autoComplete="off"
              disabled={isSaving}
              error={fieldErrors.label}
              id="social-link-label"
              label="Link label"
              maxLength={60}
              name="label"
              onChange={(event) => updateField("label", event.target.value)}
              required
              value={editor.values.label}
            />
            <TextInput
              autoComplete="url"
              disabled={isSaving}
              error={fieldErrors.url}
              hint="Use an HTTPS address. Embedded usernames and passwords are not allowed."
              id="social-link-url"
              label="URL"
              maxLength={2_048}
              name="url"
              onChange={(event) => updateField("url", event.target.value)}
              placeholder="https://example.com/your-profile"
              required
              type="url"
              value={editor.values.url}
            />
            <div aria-live="polite" className="profile-social__form-feedback">
              {pageError ? <p className="profile-management__error" role="alert">{pageError}</p> : null}
            </div>
            <div className="profile-social__form-actions">
              <Button disabled={isSaving} onClick={closeEditor} variant="subtle">
                Cancel
              </Button>
              <Button disabled={isSaving} type="submit">
                {isSaving ? (
                  <LoaderCircle aria-hidden="true" className="profile-management__spinner" size={16} />
                ) : null}
                {isSaving ? "Saving…" : "Save link"}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        description="This removes the link from the public profile. This action cannot be undone."
        onClose={() => {
          if (!deletingRef.current) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
        open={pendingDelete !== null}
        title="Delete social link?"
      >
        {pendingDelete ? (
          <div className="profile-social__delete-confirmation">
            <p>
              Delete <strong>{pendingDelete.label}</strong>? Its URL will be removed from the public profile.
            </p>
            {deleteError ? <p className="profile-management__error" role="alert">{deleteError}</p> : null}
            <div className="profile-social__form-actions">
              <Button disabled={isDeleting} onClick={() => setPendingDelete(null)} variant="subtle">
                Cancel
              </Button>
              <Button disabled={isDeleting} onClick={() => void deleteLink()} variant="secondary">
                {isDeleting ? "Deleting…" : "Delete link"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
