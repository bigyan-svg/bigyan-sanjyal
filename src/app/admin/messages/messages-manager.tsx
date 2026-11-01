"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, Check, Inbox, Mail, MailOpen, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import type {
  AdminMessageStatus,
  AdminMessageStatusFilter,
} from "@/lib/admin-messages";

interface MessageListItem {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  status: AdminMessageStatus;
  createdAt: string;
}

interface MessageListResponse {
  messages: MessageListItem[];
  total: number;
  newCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  status: AdminMessageStatusFilter;
}

interface MessageDetail extends MessageListItem {
  message: string;
  readAt: string | null;
  updatedAt: string;
}

interface JsonResponse {
  error?: unknown;
  messages?: unknown;
  message?: unknown;
}

interface MessagesManagerProps {
  initialStatus: AdminMessageStatusFilter;
  initialPage: string;
}

const STATUS_LABELS: Record<AdminMessageStatus, string> = {
  NEW: "New",
  READ: "Read",
  ARCHIVED: "Archived",
  SPAM: "Spam",
};

async function readJsonResponse(response: Response): Promise<JsonResponse> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as JsonResponse
      : {};
  } catch {
    return {};
  }
}

async function requestMessageList(
  status: AdminMessageStatusFilter,
  page: string,
): Promise<MessageListResponse> {
  const params = new URLSearchParams({ status, page });
  const response = await fetch(`/api/admin/messages?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await readJsonResponse(response);

  if (!response.ok || !Array.isArray(result.messages)) {
    throw new Error("Unable to load messages.");
  }
  return result as unknown as MessageListResponse;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function pageHref(status: AdminMessageStatusFilter, page: number): string {
  const params = new URLSearchParams({ status, page: String(page) });
  return `/admin/messages?${params.toString()}`;
}

export function MessagesManager({ initialStatus, initialPage }: MessagesManagerProps) {
  const [list, setList] = useState<MessageListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<"ARCHIVED" | "SPAM" | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const nextList = await requestMessageList(initialStatus, initialPage);
        if (!active) return;
        setList(nextList);
        setError(null);
      } catch {
        if (active) setError("Messages are temporarily unavailable. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [initialPage, initialStatus]);

  const refreshMessages = useCallback(async () => {
    setLoading(true);
    try {
      const nextList = await requestMessageList(initialStatus, initialPage);
      setList(nextList);
      setError(null);
    } catch {
      setError("Messages are temporarily unavailable. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [initialPage, initialStatus]);

  const openMessage = useCallback(async (id: string) => {
    setDetailsOpen(true);
    setOpening(true);
    setSelectedMessage(null);
    setActionError(null);
    setConfirmStatus(null);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open" }),
        cache: "no-store",
        credentials: "same-origin",
      });
      const result = await readJsonResponse(response);

      if (!response.ok || typeof result.message !== "object" || result.message === null) {
        setActionError("This message could not be opened. Please try again.");
        return;
      }

      setSelectedMessage(result.message as MessageDetail);
      await refreshMessages();
    } catch {
      setActionError("This message could not be opened. Please try again.");
    } finally {
      setOpening(false);
    }
  }, [refreshMessages]);

  const updateStatus = useCallback(async (status: AdminMessageStatus) => {
    if (!selectedMessage || actionPending) return;

    setActionPending(true);
    setActionError(null);
    setSuccess(null);
    setLoading(true);
    setConfirmStatus(null);

    try {
      const response = await fetch(
        `/api/admin/messages/${encodeURIComponent(selectedMessage.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
          cache: "no-store",
          credentials: "same-origin",
        },
      );
      const result = await readJsonResponse(response);

      if (!response.ok || typeof result.message !== "object" || result.message === null) {
        setActionError("The message could not be updated. Please try again.");
        return;
      }

      setSelectedMessage(result.message as MessageDetail);
      setSuccess(`Message marked ${STATUS_LABELS[status].toLowerCase()}.`);
      await refreshMessages();
    } catch {
      setActionError("The message could not be updated. Please try again.");
    } finally {
      setActionPending(false);
    }
  }, [actionPending, refreshMessages, selectedMessage]);

  function closeDetails() {
    if (actionPending) return;
    setDetailsOpen(false);
    setSelectedMessage(null);
    setActionError(null);
    setConfirmStatus(null);
  }

  async function updateStatusFromList(id: string, status: AdminMessageStatus) {
    if (actionPending) return;
    setActionPending(true);
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/messages/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError("The message could not be updated. Please try again.");
        return;
      }
      setSuccess(`Message marked ${STATUS_LABELS[status].toLowerCase()}.`);
      await refreshMessages();
    } catch {
      setError("The message could not be updated. Please try again.");
    } finally {
      setActionPending(false);
    }
  }

  const currentPage = list?.page ?? Number(initialPage);
  const currentStatus = list?.status ?? initialStatus;
  const selectedTitle = selectedMessage?.subject?.trim() || "Contact message";

  return (
    <div className="messages-inbox">
      {success && !detailsOpen ? (
        <p className="messages-inbox__feedback messages-inbox__feedback--success" role="status">
          <Check aria-hidden="true" size={16} />
          {success}
        </p>
      ) : null}

      {error ? (
        <p className="messages-inbox__feedback messages-inbox__feedback--error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="messages-inbox__overview">
        <Card className="messages-inbox__count-card" variant="outlined">
          <span aria-hidden="true" className="messages-inbox__count-icon"><Mail size={18} /></span>
          <div>
            <p className="eyebrow">New messages</p>
            <strong>{loading && !list ? "—" : (list?.newCount ?? 0).toLocaleString()}</strong>
          </div>
        </Card>
        <Card className="messages-inbox__count-card" variant="outlined">
          <span aria-hidden="true" className="messages-inbox__count-icon"><Inbox size={18} /></span>
          <div>
            <p className="eyebrow">Current view</p>
            <strong>{loading && !list ? "—" : (list?.total ?? 0).toLocaleString()}</strong>
          </div>
        </Card>
      </div>

      <Card className="messages-inbox__panel" variant="glow">
        <div className="messages-inbox__toolbar">
          <form action="/admin/messages" className="messages-inbox__filter" method="get">
            <label className="form-field__label" htmlFor="messages-status-filter">Filter messages</label>
            <div className="messages-inbox__filter-controls">
              <select
                className="form-control"
                defaultValue={initialStatus}
                id="messages-status-filter"
                name="status"
              >
                <option value="ALL">All messages</option>
                <option value="NEW">New</option>
                <option value="READ">Read</option>
                <option value="ARCHIVED">Archived</option>
                <option value="SPAM">Spam</option>
              </select>
              <Button type="submit" variant="secondary">Apply filter</Button>
            </div>
          </form>
          <p className="messages-inbox__sort-note">Newest messages first</p>
        </div>

        {loading ? (
          <p aria-live="polite" className="messages-inbox__loading" role="status">
            Loading messages…
          </p>
        ) : error ? null : list && list.messages.length === 0 ? (
          <div className="messages-inbox__empty">
            <MailOpen aria-hidden="true" size={23} />
            <h2>{list.total === 0 && currentStatus === "ALL" ? "No messages yet" : "No messages in this view"}</h2>
            <p>
              {list.total === 0 && currentStatus === "ALL"
                ? "Messages submitted through the Contact page will appear here."
                : "Choose another status filter to see messages."}
            </p>
          </div>
        ) : (
          <section aria-label="Contact messages" className="messages-inbox__list">
            {list?.messages.map((message) => (
              <article
                className={[
                  "messages-inbox__item",
                  message.status === "NEW" ? "messages-inbox__item--new" : "",
                ].filter(Boolean).join(" ")}
                key={message.id}
              >
                <div className="messages-inbox__item-heading">
                  <div>
                    <h2>{message.name}</h2>
                    <p>{message.email}</p>
                  </div>
                  <span className={`messages-inbox__status messages-inbox__status--${message.status.toLowerCase()}`}>
                    {STATUS_LABELS[message.status]}
                  </span>
                </div>
                <p className="messages-inbox__subject">{message.subject || "No subject"}</p>
                <p className="messages-inbox__date">Submitted {formatDate(message.createdAt)}</p>
                <div className="messages-inbox__item-actions">
                  {message.status === "NEW" ? (
                    <Button
                      aria-label={`Mark message from ${message.name} as read`}
                      disabled={actionPending}
                      onClick={() => void updateStatusFromList(message.id, "READ")}
                      size="small"
                      variant="subtle"
                    >
                      <Check aria-hidden="true" size={15} />
                      Mark read
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`Open message from ${message.name}`}
                    disabled={opening || actionPending}
                    onClick={() => void openMessage(message.id)}
                    size="small"
                  >
                    Read message
                  </Button>
                </div>
              </article>
            ))}
          </section>
        )}

        {list && list.total > 0 ? (
          <nav aria-label="Message pages" className="messages-inbox__pagination">
            <Link
              aria-disabled={currentPage <= 1}
              className="button button--subtle button--small"
              href={pageHref(currentStatus, Math.max(1, currentPage - 1))}
              onClick={(event) => {
                if (currentPage <= 1) event.preventDefault();
              }}
              tabIndex={currentPage <= 1 ? -1 : undefined}
            >
              Previous
            </Link>
            <span aria-current="page">Page {currentPage} of {list.pageCount}</span>
            <Link
              aria-disabled={currentPage >= list.pageCount}
              className="button button--subtle button--small"
              href={pageHref(currentStatus, Math.min(list.pageCount, currentPage + 1))}
              onClick={(event) => {
                if (currentPage >= list.pageCount) event.preventDefault();
              }}
              tabIndex={currentPage >= list.pageCount ? -1 : undefined}
            >
              Next
            </Link>
          </nav>
        ) : null}
      </Card>

      <Dialog
        description="Submitted contact message"
        onClose={closeDetails}
        open={detailsOpen}
        title={selectedTitle}
      >
        {opening ? (
          <p aria-live="polite" className="messages-inbox__loading" role="status">Opening message…</p>
        ) : actionError && !selectedMessage ? (
          <div className="messages-inbox__detail-error" role="alert">
            <p>{actionError}</p>
            <Button onClick={closeDetails} type="button" variant="subtle">Close</Button>
          </div>
        ) : selectedMessage ? (
          <div className="messages-inbox__detail">
            {actionError ? <p className="messages-inbox__feedback messages-inbox__feedback--error" role="alert">{actionError}</p> : null}
            {success ? <p className="messages-inbox__feedback messages-inbox__feedback--success" role="status">{success}</p> : null}

            <dl className="messages-inbox__metadata">
              <div><dt>From</dt><dd>{selectedMessage.name}</dd></div>
              <div><dt>Email</dt><dd>{selectedMessage.email}</dd></div>
              <div><dt>Subject</dt><dd>{selectedMessage.subject || "No subject"}</dd></div>
              <div><dt>Status</dt><dd><span className={`messages-inbox__status messages-inbox__status--${selectedMessage.status.toLowerCase()}`}>{STATUS_LABELS[selectedMessage.status]}</span></dd></div>
              <div><dt>Submitted</dt><dd>{formatDate(selectedMessage.createdAt)}</dd></div>
              <div><dt>Last updated</dt><dd>{formatDate(selectedMessage.updatedAt)}</dd></div>
              {selectedMessage.readAt ? <div><dt>Read</dt><dd>{formatDate(selectedMessage.readAt)}</dd></div> : null}
            </dl>

            <section aria-labelledby="message-content-title" className="messages-inbox__body-section">
              <h3 id="message-content-title">Message</h3>
              <p className="messages-inbox__body">{selectedMessage.message}</p>
            </section>

            {confirmStatus ? (
              <div aria-label={`Confirm ${confirmStatus.toLowerCase()} action`} className="messages-inbox__confirm" role="group">
                <div>
                  <strong>{confirmStatus === "SPAM" ? "Mark this message as spam?" : "Archive this message?"}</strong>
                  <p>{confirmStatus === "SPAM" ? "It will be moved out of the inbox and retained in Spam." : "It will be moved out of the inbox and retained in Archived."}</p>
                </div>
                <div className="messages-inbox__confirm-actions">
                  <Button disabled={actionPending} onClick={() => void updateStatus(confirmStatus)} size="small">
                    {actionPending ? "Saving…" : `Confirm ${confirmStatus === "SPAM" ? "spam" : "archive"}`}
                  </Button>
                  <Button disabled={actionPending} onClick={() => setConfirmStatus(null)} size="small" variant="subtle">Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="messages-inbox__actions">
                {selectedMessage.status === "NEW" ? (
                  <Button disabled={actionPending} onClick={() => void updateStatus("READ")} size="small" variant="subtle">
                    <Check aria-hidden="true" size={15} /> Mark as read
                  </Button>
                ) : selectedMessage.status === "READ" ? (
                  <Button disabled={actionPending} onClick={() => void updateStatus("NEW")} size="small" variant="subtle">
                    <Mail aria-hidden="true" size={15} /> Mark as new
                  </Button>
                ) : (
                  <Button disabled={actionPending} onClick={() => void updateStatus("NEW")} size="small" variant="subtle">
                    <Inbox aria-hidden="true" size={15} /> Restore to inbox
                  </Button>
                )}

                {selectedMessage.status === "NEW" || selectedMessage.status === "READ" ? (
                  <>
                    <Button disabled={actionPending} onClick={() => setConfirmStatus("ARCHIVED")} size="small" variant="subtle">
                      <Archive aria-hidden="true" size={15} /> Archive
                    </Button>
                    <Button disabled={actionPending} onClick={() => setConfirmStatus("SPAM")} size="small" variant="subtle">
                      <ShieldAlert aria-hidden="true" size={15} /> Mark spam
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
