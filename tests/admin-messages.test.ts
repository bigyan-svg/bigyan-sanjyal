import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_MESSAGES_PAGE_SIZE,
  handleAdminMessagePatch,
  handleAdminMessagesList,
  performAdminMessageAction,
  resolveContactMessageTransition,
  type AdminMessageDetail,
  type AdminMessageListDependencies,
  type AdminMessageListItem,
  type AdminMessagePatchDependencies,
} from "../src/lib/admin-messages";
import {
  authorizeAdminOnlyContentReadRequest,
  authorizeAdminOnlySessionToken,
} from "../src/lib/auth/admin-content-session";

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-01T12:00:00.000Z");

function listItem(
  id: string,
  status: AdminMessageListItem["status"] = "NEW",
): AdminMessageListItem {
  return {
    id,
    name: `Sender ${id.slice(0, 1)}`,
    email: "sender@example.test",
    subject: "A question",
    status,
    createdAt: new Date("2026-10-31T12:00:00.000Z"),
  };
}

function detail(
  id: string,
  status: AdminMessageDetail["status"] = "NEW",
  readAt: Date | null = null,
): AdminMessageDetail {
  return {
    ...listItem(id, status),
    message: "Line one.\n<script>alert('plain text')</script>",
    readAt,
    updatedAt: NOW,
  };
}

function listRequest(query = "", sessionToken?: string): Request {
  const headers = new Headers();
  if (sessionToken) headers.set("Cookie", `admin_session=${sessionToken}`);
  return new Request(`https://example.test/api/admin/messages${query}`, { headers });
}

function patchRequest(body: unknown, sessionToken?: string): Request {
  const headers = new Headers({
    Origin: "https://example.test",
    "Content-Type": "application/json",
  });
  if (sessionToken) headers.set("Cookie", `admin_session=${sessionToken}`);
  return new Request(`https://example.test/api/admin/messages/${VALID_ID}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function validateRoleSession(token: string) {
  if (token === "admin-session") return Promise.resolve({ user: { role: "ADMIN" } });
  if (token === "editor-session") return Promise.resolve({ user: { role: "EDITOR" } });
  return Promise.resolve(null);
}

function authorizeAdminOnlyWrite(request: Request): Promise<Response | null> {
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("admin_session="))
    ?.slice("admin_session=".length);
  return authorizeAdminOnlySessionToken(token, validateRoleSession);
}

function listDependencies(
  overrides: Partial<AdminMessageListDependencies> = {},
) {
  const calls: {
    find?: Parameters<AdminMessageListDependencies["findMessages"]>[0];
    countStatus?: AdminMessageListDependencies["countMessages"] extends (
      status: infer T,
    ) => unknown ? T : never;
    newCount: number;
  } = { newCount: 3 };
  const dependencies: AdminMessageListDependencies = {
    authorize: async () => null,
    findMessages: async (query) => {
      calls.find = query;
      return [listItem(VALID_ID)];
    },
    countMessages: async (status) => {
      calls.countStatus = status;
      return 1;
    },
    countNewMessages: async () => calls.newCount,
    ...overrides,
  };
  return { dependencies, calls };
}

function patchDependencies(
  overrides: Partial<AdminMessagePatchDependencies> = {},
) {
  const calls: { id: string | null; action: unknown; count: number } = {
    id: null,
    action: null,
    count: 0,
  };
  const dependencies: AdminMessagePatchDependencies = {
    authorize: async () => null,
    now: () => NOW,
    performAction: async (id, action) => {
      calls.id = id;
      calls.action = action;
      calls.count += 1;
      if (action.kind === "open") return detail(id, "READ", NOW);
      return detail(id, action.status, action.status === "NEW" ? null : NOW);
    },
    ...overrides,
  };
  return { dependencies, calls };
}

test("message listing denies unauthorized access before database queries", async () => {
  let databaseCalls = 0;
  const denied = Response.json({ error: "Authentication is required." }, { status: 401 });
  const { dependencies } = listDependencies({
    authorize: async () => denied,
    findMessages: async () => {
      databaseCalls += 1;
      return [];
    },
    countMessages: async () => {
      databaseCalls += 1;
      return 0;
    },
    countNewMessages: async () => {
      databaseCalls += 1;
      return 0;
    },
  });

  const response = await handleAdminMessagesList(listRequest(), dependencies);

  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);
});

test("message listing denies EDITOR before querying data and permits ADMIN", async () => {
  let editorDatabaseCalls = 0;
  const editor = listDependencies({
    authorize: (request) => authorizeAdminOnlyContentReadRequest(request, validateRoleSession),
    findMessages: async () => {
      editorDatabaseCalls += 1;
      return [];
    },
    countMessages: async () => {
      editorDatabaseCalls += 1;
      return 0;
    },
    countNewMessages: async () => {
      editorDatabaseCalls += 1;
      return 0;
    },
  });

  const editorResponse = await handleAdminMessagesList(
    listRequest("", "editor-session"),
    editor.dependencies,
  );

  assert.equal(editorResponse.status, 403);
  assert.equal(editorDatabaseCalls, 0);

  const admin = listDependencies({
    authorize: (request) => authorizeAdminOnlyContentReadRequest(request, validateRoleSession),
  });
  const adminResponse = await handleAdminMessagesList(
    listRequest("", "admin-session"),
    admin.dependencies,
  );
  const adminBody = await adminResponse.json();

  assert.equal(adminResponse.status, 200);
  assert.equal(admin.calls.find?.take, ADMIN_MESSAGES_PAGE_SIZE);
  assert.equal(adminBody.messages[0].email, "sender@example.test");
  assert.equal(adminBody.messages[0].subject, "A question");
});

test("message detail and status operations deny EDITOR before mutation and permit ADMIN", async () => {
  let editorMutationCalls = 0;
  const editor = patchDependencies({
    authorize: authorizeAdminOnlyWrite,
    performAction: async () => {
      editorMutationCalls += 1;
      return detail(VALID_ID);
    },
  });
  const editorResponse = await handleAdminMessagePatch(
    patchRequest({ action: "open" }, "editor-session"),
    VALID_ID,
    editor.dependencies,
  );

  assert.equal(editorResponse.status, 403);
  assert.equal(editorMutationCalls, 0);

  const admin = patchDependencies({ authorize: authorizeAdminOnlyWrite });
  const openResponse = await handleAdminMessagePatch(
    patchRequest({ action: "open" }, "admin-session"),
    VALID_ID,
    admin.dependencies,
  );
  const opened = await openResponse.json();
  assert.equal(openResponse.status, 200);
  assert.equal(opened.message.message, "Line one.\n<script>alert('plain text')</script>");
  assert.equal(admin.calls.count, 1);

  const statusResponse = await handleAdminMessagePatch(
    patchRequest({ status: "ARCHIVED" }, "admin-session"),
    VALID_ID,
    admin.dependencies,
  );
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(admin.calls.action, { kind: "status", status: "ARCHIVED" });
  assert.equal(admin.calls.count, 2);
});

test("message list and write handlers return 401 for unauthenticated role fixtures", async () => {
  const list = listDependencies({
    authorize: (request) => authorizeAdminOnlyContentReadRequest(request, validateRoleSession),
  });
  const listResponse = await handleAdminMessagesList(listRequest(), list.dependencies);
  assert.equal(listResponse.status, 401);
  assert.deepEqual(await listResponse.json(), { error: "Authentication is required." });
  assert.equal(list.calls.find, undefined);

  let mutationCalls = 0;
  const patch = patchDependencies({
    authorize: authorizeAdminOnlyWrite,
    performAction: async () => {
      mutationCalls += 1;
      return detail(VALID_ID);
    },
  });
  const patchResponse = await handleAdminMessagePatch(
    patchRequest({ status: "READ" }),
    VALID_ID,
    patch.dependencies,
  );
  assert.equal(patchResponse.status, 401);
  assert.equal(mutationCalls, 0);
});

test("message listing denies editor access before database queries", async () => {
  let databaseCalls = 0;
  const denied = Response.json(
    { error: "You are not authorized to manage site content." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
  const { dependencies } = listDependencies({
    authorize: async () => denied,
    findMessages: async () => {
      databaseCalls += 1;
      return [];
    },
    countMessages: async () => {
      databaseCalls += 1;
      return 0;
    },
    countNewMessages: async () => {
      databaseCalls += 1;
      return 0;
    },
  });

  const response = await handleAdminMessagesList(listRequest(), dependencies);

  assert.equal(response.status, 403);
  assert.equal(databaseCalls, 0);
});

test("authorized listing applies status filters and selects the requested page", async () => {
  const { dependencies, calls } = listDependencies({
    countMessages: async (status) => status === "READ" ? 27 : 0,
  });

  const response = await handleAdminMessagesList(
    listRequest("?status=READ&page=2"),
    dependencies,
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(result.total, 27);
  assert.equal(result.newCount, 3);
  assert.equal(result.page, 2);
  assert.equal(result.pageCount, 2);
  assert.equal(result.status, "READ");
  assert.deepEqual(calls.find, { status: "READ", skip: ADMIN_MESSAGES_PAGE_SIZE, take: ADMIN_MESSAGES_PAGE_SIZE });
  assert.equal("message" in result.messages[0], false);
});

test("out-of-range pages clamp to the last page and empty filters still request page one", async () => {
  const { dependencies, calls } = listDependencies({
    countMessages: async () => 45,
    findMessages: async (query) => {
      calls.find = query;
      return [];
    },
  });

  const response = await handleAdminMessagesList(listRequest("?status=ALL&page=99"), dependencies);
  const result = await response.json();

  assert.equal(result.page, 3);
  assert.equal(result.pageCount, 3);
  assert.equal(calls.find?.skip, ADMIN_MESSAGES_PAGE_SIZE * 2);

  const empty = listDependencies({ countMessages: async () => 0 });
  const emptyResponse = await handleAdminMessagesList(listRequest("?status=SPAM"), empty.dependencies);
  const emptyResult = await emptyResponse.json();
  assert.equal(emptyResult.page, 1);
  assert.equal(emptyResult.pageCount, 1);
  assert.deepEqual(emptyResult.messages, []);
  assert.equal(empty.calls.find, undefined);
});

test("listing rejects invalid filters without querying the database", async () => {
  let countCalls = 0;
  const { dependencies } = listDependencies({
    countMessages: async () => {
      countCalls += 1;
      return 0;
    },
  });

  for (const query of ["?status=PUBLISHED", "?page=0", "?page=2&page=3", "?secret=x"]) {
    const response = await handleAdminMessagesList(listRequest(query), dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid message filters." });
  }
  assert.equal(countCalls, 0);
});

test("database listing failures return safe no-store errors", async () => {
  const { dependencies } = listDependencies({
    countMessages: async () => {
      throw new Error("private database details");
    },
  });

  const response = await handleAdminMessagesList(listRequest(), dependencies);

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Unable to load messages." });
});

test("authorized opening of a new message returns its content after marking it read", async () => {
  const { dependencies, calls } = patchDependencies({
    performAction: async (id, action, now) => {
      calls.id = id;
      calls.action = action;
      calls.count += 1;
      const transition = resolveContactMessageTransition(
        { status: "NEW", readAt: null },
        action,
        now,
      );
      return detail(id, transition.status, transition.readAt);
    },
  });

  const response = await handleAdminMessagePatch(
    patchRequest({ action: "open" }),
    VALID_ID,
    dependencies,
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls.action, { kind: "open" });
  assert.equal(result.message.status, "READ");
  assert.equal(result.message.readAt, NOW.toISOString());
  assert.equal(result.message.message, "Line one.\n<script>alert('plain text')</script>");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("opening an already read, archived, or spam message preserves its status", () => {
  for (const status of ["READ", "ARCHIVED", "SPAM"] as const) {
    const transition = resolveContactMessageTransition(
      { status, readAt: null },
      { kind: "open" },
      NOW,
    );
    assert.equal(transition.status, status);
    assert.equal(transition.changed, false);
  }
});

test("status transitions mark read, archive or spam, and restore to new", () => {
  const markRead = resolveContactMessageTransition(
    { status: "NEW", readAt: null },
    { kind: "status", status: "READ" },
    NOW,
  );
  assert.equal(markRead.status, "READ");
  assert.equal(markRead.readAt, NOW);
  assert.equal(markRead.changed, true);

  const archive = resolveContactMessageTransition(
    { status: "READ", readAt: NOW },
    { kind: "status", status: "ARCHIVED" },
    new Date(NOW.getTime() + 1000),
  );
  assert.equal(archive.status, "ARCHIVED");
  assert.equal(archive.readAt, NOW);

  const spam = resolveContactMessageTransition(
    { status: "NEW", readAt: null },
    { kind: "status", status: "SPAM" },
    NOW,
  );
  assert.equal(spam.status, "SPAM");
  assert.equal(spam.readAt, null);

  for (const status of ["ARCHIVED", "SPAM"] as const) {
    const restored = resolveContactMessageTransition(
      { status, readAt: NOW },
      { kind: "status", status: "NEW" },
      new Date(NOW.getTime() + 1000),
    );
    assert.equal(restored.status, "NEW");
    assert.equal(restored.readAt, null);
  }
});

test("message status updates return 409 when concurrent writes exhaust retries", async () => {
  let state: { status: AdminMessageDetail["status"]; readAt: Date | null } = {
    status: "NEW",
    readAt: null,
  };
  let updateAttempts = 0;
  let detailReads = 0;
  const { dependencies } = patchDependencies({
    performAction: (id, action, now) =>
      performAdminMessageAction({
        findState: async () => ({ ...state }),
        updateState: async () => {
          updateAttempts += 1;
          state = {
            status: updateAttempts === 1 ? "READ" : "SPAM",
            readAt: NOW,
          };
          return false;
        },
        findDetail: async (messageId) => {
          detailReads += 1;
          return detail(messageId, state.status, state.readAt);
        },
      }, id, action, now),
  });

  const response = await handleAdminMessagePatch(
    patchRequest({ status: "ARCHIVED" }),
    VALID_ID,
    dependencies,
  );
  const result = await response.json();

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(result.error, "This message changed elsewhere. Review its current state and try again.");
  assert.equal(result.message.status, "SPAM");
  assert.equal(updateAttempts, 2);
  assert.equal(detailReads, 1);
});

test("message status updates require authorization before action handling", async () => {
  let actions = 0;
  const denied = Response.json({ error: "Authentication is required." }, { status: 401 });
  const { dependencies } = patchDependencies({
    authorize: async () => denied,
    performAction: async () => {
      actions += 1;
      return null;
    },
  });

  const response = await handleAdminMessagePatch(
    patchRequest({ status: "READ" }),
    VALID_ID,
    dependencies,
  );

  assert.equal(response.status, 401);
  assert.equal(actions, 0);
});

test("message details and status updates deny editor access before action handling", async () => {
  let actions = 0;
  const denied = Response.json(
    { error: "You are not authorized to manage site content." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
  const { dependencies } = patchDependencies({
    authorize: async () => denied,
    performAction: async () => {
      actions += 1;
      return null;
    },
  });

  const response = await handleAdminMessagePatch(
    patchRequest({ action: "open" }),
    VALID_ID,
    dependencies,
  );

  assert.equal(response.status, 403);
  assert.equal(actions, 0);
});

test("message updates reject invalid IDs, statuses, and unexpected request fields", async () => {
  const { dependencies, calls } = patchDependencies();

  const invalidId = await handleAdminMessagePatch(
    patchRequest({ status: "READ" }),
    "not-a-uuid",
    dependencies,
  );
  assert.equal(invalidId.status, 404);

  const invalidStatus = await handleAdminMessagePatch(
    patchRequest({ status: "PUBLISHED" }),
    VALID_ID,
    dependencies,
  );
  assert.equal(invalidStatus.status, 422);
  assert.deepEqual(await invalidStatus.json(), { error: "Invalid message status." });

  const extraField = await handleAdminMessagePatch(
    patchRequest({ status: "READ", admin: true }),
    VALID_ID,
    dependencies,
  );
  assert.equal(extraField.status, 400);
  assert.equal(calls.count, 0);
});

test("message updates reject oversized request bodies", async () => {
  const { dependencies, calls } = patchDependencies();
  const body = JSON.stringify({ status: "READ", note: "x".repeat(5000) });
  const request = new Request(`https://example.test/api/admin/messages/${VALID_ID}`, {
    method: "PATCH",
    headers: {
      Origin: "https://example.test",
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  });

  const response = await handleAdminMessagePatch(request, VALID_ID, dependencies);

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
  assert.equal(calls.count, 0);
});

test("missing messages and database errors return safe responses", async () => {
  const missing = patchDependencies({ performAction: async () => null });
  const missingResponse = await handleAdminMessagePatch(
    patchRequest({ action: "open" }),
    OTHER_ID,
    missing.dependencies,
  );
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "Message not found." });

  const failed = patchDependencies({
    performAction: async () => {
      throw new Error("private database details");
    },
  });
  const failedResponse = await handleAdminMessagePatch(
    patchRequest({ status: "ARCHIVED" }),
    VALID_ID,
    failed.dependencies,
  );
  assert.equal(failedResponse.status, 500);
  assert.deepEqual(await failedResponse.json(), { error: "Unable to update the message." });
});
