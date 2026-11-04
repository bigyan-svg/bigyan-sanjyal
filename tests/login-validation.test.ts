import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLoginCredentials } from "../src/lib/auth/login-validation";

test("login validation rejects unexpected fields", () => {
  assert.equal(
    parseLoginCredentials({
      email: "admin@example.com",
      password: "example password",
      role: "ADMIN",
    }),
    null,
  );
});

test("login validation rejects missing fields", () => {
  assert.equal(parseLoginCredentials({ email: "admin@example.com" }), null);
  assert.equal(parseLoginCredentials({ password: "example password" }), null);
});

test("login validation rejects incorrect field types", () => {
  assert.equal(parseLoginCredentials({ email: 123, password: "example" }), null);
  assert.equal(parseLoginCredentials({ email: "admin@example.com", password: null }), null);
});

test("login validation accepts and normalizes valid credentials", () => {
  assert.deepEqual(
    parseLoginCredentials({
      email: " Admin@Example.com ",
      password: "example password",
    }),
    { email: "admin@example.com", password: "example password" },
  );
});
