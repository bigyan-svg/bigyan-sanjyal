import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  hashAdminPassword,
  verifyAdminPassword,
} from "../src/lib/auth/password";

test("Admin passwords use Argon2id and verify only against the original password", async () => {
  const password = `test-only-${randomBytes(32).toString("base64url")}`;
  const incorrectPassword = `test-only-${randomBytes(32).toString("base64url")}`;
  const passwordHash = await hashAdminPassword(password);

  assert.match(passwordHash, /^\$argon2id\$/u);
  assert.notEqual(passwordHash, password);
  assert.equal(await verifyAdminPassword(password, passwordHash), true);
  assert.equal(await verifyAdminPassword(incorrectPassword, passwordHash), false);
});
