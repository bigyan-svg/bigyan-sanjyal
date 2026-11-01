import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authorizeAdminContentReadRequest,
  type AdminContentSession,
} from "../src/lib/auth/admin-content-session";

function request(cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("Cookie", cookie);
  return new Request("https://example.test/api/admin/messages?status=ALL&page=1", { headers });
}

test("read authorization validates the admin session cookie from the actual request", async () => {
  let validatedToken: string | null = null;
  const response = await authorizeAdminContentReadRequest(
    request("theme=dark; admin_session=test-session-token"),
    async (token) => {
      validatedToken = token;
      return { user: { role: "ADMIN" } };
    },
  );

  assert.equal(response, null);
  assert.equal(validatedToken, "test-session-token");
});

test("read authorization accepts the existing ADMIN and EDITOR roles", async () => {
  for (const role of ["ADMIN", "EDITOR"]) {
    const response = await authorizeAdminContentReadRequest(
      request("admin_session=valid-session"),
      async () => ({ user: { role } }),
    );
    assert.equal(response, null);
  }
});

test("missing or invalid sessions receive a no-store 401 without validating an absent cookie", async () => {
  let validations = 0;
  const absent = await authorizeAdminContentReadRequest(request(), async () => {
    validations += 1;
    return { user: { role: "ADMIN" } };
  });
  assert.equal(absent?.status, 401);
  assert.equal(absent?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await absent?.json(), { error: "Authentication is required." });
  assert.equal(validations, 0);

  const invalid = await authorizeAdminContentReadRequest(
    request("admin_session=expired-session"),
    async () => null,
  );
  assert.equal(invalid?.status, 401);
  assert.equal(invalid?.headers.get("cache-control"), "no-store");
});

test("read authorization returns 403 for roles outside the admin content allowlist", async () => {
  const response = await authorizeAdminContentReadRequest(
    request("admin_session=valid-session"),
    async () => ({ user: { role: "VIEWER" } }),
  );

  assert.equal(response?.status, 403);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response?.json(), {
    error: "You are not authorized to manage site content.",
  });
});

test("ambiguous duplicate session cookies are rejected", async () => {
  let validations = 0;
  const response = await authorizeAdminContentReadRequest(
    request("admin_session=first; admin_session=second"),
    async (): Promise<AdminContentSession | null> => {
      validations += 1;
      return { user: { role: "ADMIN" } };
    },
  );

  assert.equal(response?.status, 401);
  assert.equal(validations, 0);
});

test("unexpected session validation failures remain generic no-store 500 responses", async () => {
  const response = await authorizeAdminContentReadRequest(
    request("admin_session=valid-session"),
    async () => {
      throw new Error("sensitive validation details");
    },
  );

  assert.equal(response?.status, 500);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response?.json(), { error: "Unable to authorize this request." });
});
