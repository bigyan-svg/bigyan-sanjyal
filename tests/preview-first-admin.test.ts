import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  PREVIEW_ADMIN_ADVISORY_LOCK_ID,
  PREVIEW_ADMIN_ADVISORY_LOCK_NAMESPACE,
  PREVIEW_ADMIN_ADVISORY_LOCK_QUERY,
  PreviewFirstAdminError,
  provisionFirstPreviewAdmin,
  type PreviewFirstAdminStore,
} from "../src/lib/preview-first-admin";

const LOCK_QUERY = PREVIEW_ADMIN_ADVISORY_LOCK_QUERY;

function assertLockQuery(query: string, values: readonly unknown[]): void {
  assert.equal(query, LOCK_QUERY);
  assert.deepEqual(values, [
    PREVIEW_ADMIN_ADVISORY_LOCK_NAMESPACE,
    PREVIEW_ADMIN_ADVISORY_LOCK_ID,
  ]);
}

function createStore(
  accountCount = 0,
  options: { failLock?: boolean } = {},
) {
  let locked = false;
  let count = accountCount;
  let created = 0;
  const calls: string[] = [];
  const store: PreviewFirstAdminStore = {
    async $queryRawUnsafe(query, ...values) {
      assertLockQuery(query, values);
      calls.push("lock");
      if (options.failLock) throw new Error("simulated advisory-lock failure");
      locked = true;
      return [{ locked: true }];
    },
    adminUser: {
      async count() {
        assert.equal(locked, true);
        calls.push("count");
        return count;
      },
      async create() {
        assert.equal(locked, true);
        calls.push("create");
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
    getCalls: () => calls,
  };
}

test("provisions the first Preview administrator successfully", async () => {
  const { store, getCreated, getCalls } = createStore();
  const account = await provisionFirstPreviewAdmin(
    store,
    "preview-admin@example.test",
    "never-print-this-password-hash",
  );
  assert.equal(account.id, "admin-preview-id");
  assert.equal(getCreated(), 1);
  assert.deepEqual(getCalls(), ["lock", "count", "create"]);
});

test("existing accounts prevent Preview first-admin provisioning", async () => {
  const { store, getCalls } = createStore(1);
  await assert.rejects(
    () => provisionFirstPreviewAdmin(
      store,
      "preview-admin@example.test",
      "never-print-this-password-hash",
    ),
    PreviewFirstAdminError,
  );
  assert.deepEqual(getCalls(), ["lock", "count"]);
});

test("advisory-lock failure prevents all provisioning queries", async () => {
  const { store, getCalls, getCreated } = createStore(0, { failLock: true });

  await assert.rejects(
    () => provisionFirstPreviewAdmin(
      store,
      "preview-admin@example.test",
      "never-print-this-password-hash",
    ),
    /simulated advisory-lock failure/u,
  );

  assert.deepEqual(getCalls(), ["lock"]);
  assert.equal(getCreated(), 0);
});

test("concurrent provisioning attempts cannot create multiple accounts", async () => {
  let count = 0;
  let created = 0;
  let releaseLock: (() => void) | undefined;
  const lock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  const store = (wait: boolean): PreviewFirstAdminStore => {
    let locked = false;
    return {
      async $queryRawUnsafe(query, ...values) {
        assertLockQuery(query, values);
        if (wait) await lock;
        locked = true;
        return [{ locked: true }];
      },
      adminUser: {
        async count() {
          assert.equal(locked, true);
          return count;
        },
        async create(args) {
          assert.equal(locked, true);
          assert.equal(args.data.role, "ADMIN");
          assert.equal(args.data.isActive, true);
          if (count !== 0) throw new PreviewFirstAdminError("account already exists");
          count += 1;
          created += 1;
          return { id: "admin-preview-id" };
        },
      },
    };
  };

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

test("Preview bootstrap invokes provisioning within its serializable transaction", async () => {
  const source = await readFile(
    new URL("../scripts/admin-preview-bootstrap.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /prisma\.\$transaction\(\s*\(transaction\)\s*=>\s*provisionFirstPreviewAdmin\(/u,
  );
  assert.match(source, /isolationLevel:\s*PREVIEW_ADMIN_TRANSACTION_ISOLATION/u);
});
