import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminOperatorGuardError,
  assertProductionAdminOperatorTarget,
  getAdminOperatorConfirmationPhrase,
  normalizeAdminOperatorEmail,
} from "../src/lib/admin-operator-guards";
import type { SafeDatabaseTarget } from "../src/lib/auth/auth-diagnostics";

const target: SafeDatabaseTarget = {
  host: "db.example.test",
  port: "5432",
  database: "portfolio",
};

test("requires explicit production environment and a parsed database target", () => {
  assert.throws(
    () => assertProductionAdminOperatorTarget("development", target),
    AdminOperatorGuardError,
  );
  assert.throws(
    () => assertProductionAdminOperatorTarget("production", null),
    AdminOperatorGuardError,
  );
  assert.doesNotThrow(() => assertProductionAdminOperatorTarget("production", target));
});

test("confirmation phrases bind each operation to its displayed target", () => {
  assert.equal(
    getAdminOperatorConfirmationPhrase("provision-first", target),
    "PROVISION FIRST ADMIN db.example.test:5432/portfolio",
  );
  assert.equal(
    getAdminOperatorConfirmationPhrase("recover", target),
    "RECOVER ADMIN ACCESS db.example.test:5432/portfolio",
  );
});

test("normalizes administrator email and rejects malformed or oversized values", () => {
  assert.equal(normalizeAdminOperatorEmail(" Admin@Example.test "), "admin@example.test");
  assert.equal(normalizeAdminOperatorEmail("not-an-email"), null);
  assert.equal(normalizeAdminOperatorEmail("a".repeat(321) + "@example.test"), null);
});
