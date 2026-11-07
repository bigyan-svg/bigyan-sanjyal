import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PreviewFirstAdminError,
  provisionFirstPreviewAdmin,
  type PreviewFirstAdminStore,
} from "../src/lib/preview-first-admin";

function createStore(accountCount = 0) {
  let locked = false;
  let count = accountCount;
  let created = 0;
  const store: PreviewFirstAdminStore = {
    async $executeRawUnsafe() {
      locked = true;
      return 1;
    },
    adminUser: {
      async count() {
        assert.equal(locked, true);
        return count;
      },
      async create() {
        assert.equal(locked, true);
        if (count !== 0) throw new PreviewFirstAdminError("unexpected duplicate");
        count += 1;
        created += 1;
        return { id: "admin-preview-id" };
      },
    },
  };
  return {
    store,
    getCreated: () => created,
  };
}

test("provisions the first Preview administrator successfully", async () => {
  const { store, getCreated } = createStore();
  const account = await provisionFirstPreviewAdmin(
    store,
    "preview-admin@example.test",
    "never-print-this-password-hash",
  );
  assert.equal(account.id, "admin-preview-id");
  assert.equal(getCreated(), 1);
});

test("existing accounts prevent Preview first-admin provisioning", async () => {
  const { store } = createStore(1);
  await assert.rejects(
    () => provisionFirstPreviewAdmin(
      store,
      "preview-admin@example.test",
      "never-print-this-password-hash",
    ),
    PreviewFirstAdminError,
  );
});

test("concurrent provisioning attempts cannot create multiple accounts", async () => {
  let count = 0;
  let created = 0;
  let releaseLock: (() => void) | undefined;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const store = (wait: boolean): PreviewFirstAdminStore => ({
    async $executeRawUnsafe() {
      if (wait) await lock;
      return 1;
    },
    adminUser: {
      async count() {
        return count;
      },
      async create(args) {
        assert.equal(args.data.role, "ADMIN");
        assert.equal(args.data.isActive, true);
        if (count !== 0) throw new PreviewFirstAdminError("account already exists");
        count += 1;
        created += 1;
        return { id: "admin-preview-id" };
      },
    },
  });

  const first = provisionFirstPreviewAdmin(
    store(true),
    "first@example.test",
    "never-print-this-password-hash",
  );
  const second = provisionFirstPreviewAdmin(
    store(false),
    "second@example.test",
    "never-print-this-password-hash",
  );
  releaseLock?.();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(created, 1);
});
