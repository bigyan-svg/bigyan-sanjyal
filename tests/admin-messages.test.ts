import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_MESSAGES_PAGE_SIZE,
  handleAdminMessagePatch,
  handleAdminMessagesList,
  resolveContactMessageTransition,
  type AdminMessageDetail,
  type AdminMessageListDependencies,
  type AdminMessageListItem,
  type AdminMessagePatchDependencies,
} from "../src/lib/admin-messages";

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

function listRequest(query = ""): Request {
  return new Request(`https://example.test/api/admin/messages${query}`);
}

function patchRequest(body: unknown): Request {
  return new Request(`https://example.test/api/admin/messages/${VALID_ID}`, {
    method: "PATCH",
    headers: {
      Origin: "https://example.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
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
