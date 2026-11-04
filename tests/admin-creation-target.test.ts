import assert from "node:assert/strict";
import { test } from "node:test";
import { getAdminCreationTarget } from "../src/lib/admin-creation-target";

test("admin creation target shows a safe host/database confirmation without credentials", () => {
  const target = getAdminCreationTarget(
    "postgresql://private-user:private-password@db.example.test:5433/site_db?sslmode=require",
  );

  assert.deepEqual(target, {
    confirmation: "db.example.test:5433/site_db",
    display: "db.example.test:5433/site_db",
  });
  assert.equal(target?.display.includes("private-user"), false);
  assert.equal(target?.display.includes("private-password"), false);
});

test("admin creation target refuses unknown or overridden targets", () => {
  assert.equal(getAdminCreationTarget(undefined), null);
  assert.equal(getAdminCreationTarget("not-a-database-url"), null);
  assert.equal(
    getAdminCreationTarget("postgres://user:password@db.example.test/site_db?host=other.test"),
    null,
  );
});
