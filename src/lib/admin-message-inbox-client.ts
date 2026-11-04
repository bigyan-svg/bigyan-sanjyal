import type {
  AdminMessageStatus,
  AdminMessageStatusFilter,
} from "./admin-messages";

export interface AdminMessageListItem {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  status: AdminMessageStatus;
  createdAt: string;
}

export interface AdminMessageListResponse {
  messages: AdminMessageListItem[];
  total: number;
  newCount: number;
  page: number;
  pageCount: number;
  pageSize: number;
  status: AdminMessageStatusFilter;
}

export interface AdminMessageDetail extends AdminMessageListItem {
  message: string;
  readAt: string | null;
  updatedAt: string;
}

export interface AdminMessageJsonResponse {
  error?: unknown;
  messages?: unknown;
  message?: unknown;
}

export type AdminMessageFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function readJsonResponse(response: Response): Promise<AdminMessageJsonResponse> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as AdminMessageJsonResponse
      : {};
  } catch {
    return {};
  }
}

export async function requestAdminMessageList(
  status: AdminMessageStatusFilter,
  page: string,
  fetcher: AdminMessageFetcher = fetch,
): Promise<AdminMessageListResponse> {
  const params = new URLSearchParams({ status, page });
  const response = await fetcher(`/api/admin/messages?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await readJsonResponse(response);

  if (!response.ok || !Array.isArray(result.messages)) {
    throw new Error("Unable to load messages.");
  }
  return result as unknown as AdminMessageListResponse;
}

export async function requestAdminMessageAction(
  id: string,
  action: { action: "open" } | { status: AdminMessageStatus },
  fetcher: AdminMessageFetcher = fetch,
): Promise<AdminMessageJsonResponse> {
  const response = await fetcher(`/api/admin/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = await readJsonResponse(response);

  if (!response.ok || typeof result.message !== "object" || result.message === null) {
    throw new Error("Unable to update the message.");
  }
  return result;
}

export async function runAdminMessageMutation<T>(
  operation: () => Promise<T>,
  setLoading: (loading: boolean) => void,
  setPending: (pending: boolean) => void,
): Promise<T> {
  setLoading(true);
  setPending(true);
  try {
    return await operation();
  } finally {
    setLoading(false);
    setPending(false);
  }
}

export async function runSingleAdminMessageRefresh<T>(
  pending: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<{ kind: "joined" | "complete"; value: T }> {
  if (pending.current) {
    return { kind: "joined", value: await pending.current };
  }

  const request = operation();
  const trackedRequest = request.finally(() => {
    if (pending.current === trackedRequest) pending.current = null;
  });
  pending.current = trackedRequest;
  return { kind: "complete", value: await trackedRequest };
}

export async function runSingleAdminMessageMutation<T>(
  pending: { current: boolean },
  operation: () => Promise<T>,
  setLoading: (loading: boolean) => void,
  setPending: (pending: boolean) => void,
): Promise<{ kind: "busy" } | { kind: "complete"; value: T }> {
  if (pending.current) return { kind: "busy" };
  pending.current = true;
  try {
    return {
      kind: "complete",
      value: await runAdminMessageMutation(operation, setLoading, setPending),
    };
  } finally {
    pending.current = false;
  }
}
