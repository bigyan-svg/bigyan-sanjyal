import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminMessageConflictError,
  requestAdminMessageAction,
  requestAdminMessageList,
  runAdminMessageMutation,
  runSingleAdminMessageMutation,
  runSingleAdminMessageRefresh,
} from "../src/lib/admin-message-inbox-client";

const LIST_RESPONSE = {
  messages: [],
  total: 0,
  newCount: 0,
  page: 1,
  pageCount: 1,
  pageSize: 20,
  status: "NEW",
};

test("initial inbox load can fail and the same request recovers on retry", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  let attempt = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    attempt += 1;
    return attempt === 1
      ? Response.json({ error: "internal details" }, { status: 500 })
      : Response.json(LIST_RESPONSE);
  };

  await assert.rejects(requestAdminMessageList("NEW", "2", fetcher));
  const recovered = await requestAdminMessageList("NEW", "2", fetcher);

  assert.deepEqual(recovered, LIST_RESPONSE);
  assert.equal(calls.length, 2);
  assert.equal(String(calls[0]?.input), "/api/admin/messages?status=NEW&page=2");
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(calls[1]?.init?.cache, "no-store");
});

test("inbox refresh gate prevents overlapping retries and releases after failure", async () => {
  const gate: { current: Promise<string> | null } = { current: null };
  let releaseFirst: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let calls = 0;

  const first = runSingleAdminMessageRefresh(gate, async () => {
    calls += 1;
    await firstRequest;
    throw new Error("network failure");
  });
  const overlapping = runSingleAdminMessageRefresh(gate, async () => {
    calls += 1;
    return "unexpected";
  });
  releaseFirst?.();
  await assert.rejects(first, /network failure/u);
  await assert.rejects(overlapping, /network failure/u);
  assert.equal(gate.current, null);

  const retry = await runSingleAdminMessageRefresh(gate, async () => {
    calls += 1;
    return "recovered";
  });
  assert.deepEqual(retry, { kind: "complete", value: "recovered" });
  assert.equal(calls, 2);
});

test("inbox status mutation gate prevents duplicate submissions and releases after failure", async () => {
  const gate = { current: false };
  let releaseFirst: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const state = { loading: false, pending: false };
  let calls = 0;

  const first = runSingleAdminMessageMutation(
    gate,
    async () => {
      calls += 1;
      await firstRequest;
      throw new Error("network failure");
    },
    (loading) => { state.loading = loading; },
    (pending) => { state.pending = pending; },
  );
  const duplicate = await runSingleAdminMessageMutation(
    gate,
    async () => { calls += 1; return "unexpected"; },
    (loading) => { state.loading = loading; },
    (pending) => { state.pending = pending; },
  );

  assert.deepEqual(duplicate, { kind: "busy" });
  releaseFirst?.();
  await assert.rejects(first, /network failure/u);
  assert.equal(calls, 1);
  assert.equal(gate.current, false);
  assert.deepEqual(state, { loading: false, pending: false });
});

test("failed detail status mutation resets pending and loading for HTTP and network errors", async () => {
  const failures = [
    () => requestAdminMessageAction(
      "11111111-1111-4111-8111-111111111111",
      { status: "READ" },
      async () => Response.json({ error: "private details" }, { status: 500 }),
    ),
    () => requestAdminMessageAction(
      "11111111-1111-4111-8111-111111111111",
      { status: "READ" },
      async () => { throw new Error("network failure"); },
    ),
  ];

  for (const operation of failures) {
    let loading = false;
    let pending = false;
    const transitions: Array<[boolean, boolean]> = [];
    await assert.rejects(
      runAdminMessageMutation(operation, (value) => {
        loading = value;
        transitions.push([loading, pending]);
      }, (value) => {
        pending = value;
        transitions.push([loading, pending]);
      }),
    );
    assert.equal(loading, false);
    assert.equal(pending, false);
    assert.deepEqual(transitions, [[true, false], [true, true], [false, true], [false, false]]);
  }
});

test("failed list status mutation resets pending and loading for HTTP and network errors", async () => {
  const failures = [
    () => requestAdminMessageAction(
      "11111111-1111-4111-8111-111111111111",
      { status: "ARCHIVED" },
      async () => Response.json({ error: "private details" }, { status: 409 }),
    ),
    () => requestAdminMessageAction(
      "11111111-1111-4111-8111-111111111111",
      { status: "ARCHIVED" },
      async () => { throw new Error("network failure"); },
    ),
  ];

  for (const operation of failures) {
    let loading = false;
    let pending = false;
    await assert.rejects(runAdminMessageMutation(operation, (value) => {
      loading = value;
    }, (value) => {
      pending = value;
    }));
    assert.equal(loading, false);
    assert.equal(pending, false);
  }
});

test("message update conflicts expose the current record for refresh", async () => {
  const currentMessage = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Sender",
    email: "sender@example.test",
    subject: "A question",
    status: "SPAM",
    createdAt: "2026-10-31T12:00:00.000Z",
    message: "Current message content",
    readAt: null,
    updatedAt: "2026-11-01T12:00:00.000Z",
  };

  await assert.rejects(
    requestAdminMessageAction(
      currentMessage.id,
      { status: "ARCHIVED" },
      async () => Response.json({
        error: "This message changed elsewhere.",
        message: currentMessage,
      }, { status: 409 }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof AdminMessageConflictError);
      assert.deepEqual(error.currentMessage, currentMessage);
      return true;
    },
  );
});

