import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmAdminNavigationIfDirty,
  hasPendingAdminOperations,
  hasProtectedAdminForms,
  recordAdminHistoryPush,
  resolveAdminHistoryTraversal,
  setAdminFormProtection,
  type AdminHistoryLedger,
} from "../src/lib/admin-navigation-guard";

function ledger(): AdminHistoryLedger {
  return {
    entries: [
      { id: "entry-a", href: "/admin/profile" },
      { id: "entry-b", href: "/admin/settings" },
      { id: "entry-c", href: "/admin/messages" },
    ],
    index: 1,
  };
}

test("shared dirty-form registry prompts only while at least one form is dirty", () => {
  const formId = "admin-navigation-guard-test-form";
  let confirmations = 0;
  const confirm = () => { confirmations += 1; return false; };

  setAdminFormProtection(formId, false);
  assert.equal(hasProtectedAdminForms(), false);
  assert.equal(confirmAdminNavigationIfDirty(confirm), true);
  assert.equal(confirmations, 0);

  setAdminFormProtection(formId, true);
  assert.equal(hasProtectedAdminForms(), true);
  assert.equal(confirmAdminNavigationIfDirty(confirm), false);
  assert.equal(confirmations, 1);

  setAdminFormProtection(formId, false);
  assert.equal(hasProtectedAdminForms(), false);
});

test("a clean form with a pending save remains protected until the request settles", () => {
  const formId = "admin-navigation-pending-save-test-form";
  let confirmations = 0;
  const confirm = () => { confirmations += 1; return false; };

  setAdminFormProtection(formId, false, true);
  assert.equal(hasProtectedAdminForms(), true);
  assert.equal(hasPendingAdminOperations(), true);
  assert.equal(confirmAdminNavigationIfDirty(confirm), false);
  assert.equal(confirmations, 0, "pending writes cannot be overridden by confirming the discard prompt");

  setAdminFormProtection(formId, false, false);
  assert.equal(hasProtectedAdminForms(), false);
  assert.equal(hasPendingAdminOperations(), false);
  assert.equal(confirmAdminNavigationIfDirty(confirm), true);
  assert.equal(confirmations, 0);
});

test("a pending write cannot be overridden even when the discard confirmation would approve navigation", () => {
  const formId = "admin-navigation-pending-confirm-test-form";
  let confirmations = 0;
  setAdminFormProtection(formId, true, true);

  assert.equal(confirmAdminNavigationIfDirty(() => { confirmations += 1; return true; }), false);
  assert.equal(confirmations, 0);
  setAdminFormProtection(formId, false, false);
});

test("clean Back and Forward traversals are allowed without a prompt", () => {
  const history = ledger();
  let confirmations = 0;
  const confirm = () => { confirmations += 1; return false; };

  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-a", false, confirm), {
    kind: "allow",
    index: 0,
  });
  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-c", false, confirm), {
    kind: "allow",
    index: 2,
  });
  assert.equal(confirmations, 0);
});

test("dirty Back and Forward traversals restore the exact current history entry when canceled", () => {
  const history = ledger();
  let confirmations = 0;
  const cancel = () => { confirmations += 1; return false; };

  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-a", true, cancel), {
    kind: "restore",
    delta: 1,
  });
  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-c", true, cancel), {
    kind: "restore",
    delta: -1,
  });
  assert.equal(confirmations, 2);
  assert.equal(history.index, 1);
});

test("dirty Back and Forward traversals proceed after confirmation", () => {
  const history = ledger();
  let confirmations = 0;
  const confirm = () => { confirmations += 1; return true; };

  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-a", true, confirm), {
    kind: "allow",
    index: 0,
  });
  assert.deepEqual(resolveAdminHistoryTraversal(history, "entry-c", true, confirm), {
    kind: "allow",
    index: 2,
  });
  assert.equal(confirmations, 2);
});

test("untracked history entries are explicit and do not guess a traversal direction", () => {
  assert.deepEqual(resolveAdminHistoryTraversal(ledger(), null, true, () => false), {
    kind: "untracked",
  });
  assert.deepEqual(resolveAdminHistoryTraversal(ledger(), "unknown", true, () => false), {
    kind: "untracked",
  });
});

test("recording a new App Router route truncates the forward branch without adding duplicate entries", () => {
  const history = ledger();
  const afterBack = { ...history, index: 0 };
  const next = recordAdminHistoryPush(afterBack, "/admin/projects", "entry-d");

  assert.deepEqual(next, {
    entries: [
      { id: "entry-a", href: "/admin/profile" },
      { id: "entry-d", href: "/admin/projects" },
    ],
    index: 1,
  });
});
