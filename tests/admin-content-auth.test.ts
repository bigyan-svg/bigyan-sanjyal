import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  authorizeAdminOnlyContentReadRequest,
  authorizeAdminOnlySessionToken,
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

test("admin-only read authorization accepts ADMIN and denies EDITOR", async () => {
  const adminResponse = await authorizeAdminOnlyContentReadRequest(
    request("admin_session=valid-session"),
    async () => ({ user: { role: "ADMIN" } }),
  );
  assert.equal(adminResponse, null);

  const editorResponse = await authorizeAdminOnlyContentReadRequest(
    request("admin_session=valid-session"),
    async () => ({ user: { role: "EDITOR" } }),
  );
  assert.equal(editorResponse?.status, 403);
  assert.equal(editorResponse?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await editorResponse?.json(), {
    error: "You are not authorized to manage site content.",
  });
});

test("admin-only read authorization returns the existing response for unauthenticated requests", async () => {
  let validated = false;
  const response = await authorizeAdminOnlyContentReadRequest(
    request(),
    async () => {
      validated = true;
      return null;
    },
  );

  assert.equal(validated, false);
  assert.equal(response?.status, 401);
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response?.json(), { error: "Authentication is required." });
});

test("the ADMIN-only write wrapper uses the tested ADMIN-only session authorization", async () => {
  const writeHelper = await readFile(
    new URL("../src/lib/auth/admin-content.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    writeHelper,
    /return authorizeAdminOnlySessionToken\(token, validateAdminSession\);/u,
  );
  assert.match(
    writeHelper,
    /return authorizeContentWrite\(request, requireJson, authorizeAdminOnlyContentCookieSession\);/u,
  );

  const sessionFixture = async (token: string): Promise<AdminContentSession | null> =>
    token === "admin-session"
      ? { user: { role: "ADMIN" } }
      : token === "editor-session"
        ? { user: { role: "EDITOR" } }
        : null;

  assert.equal(await authorizeAdminOnlySessionToken("admin-session", sessionFixture), null);

  const editorResponse = await authorizeAdminOnlySessionToken(
    "editor-session",
    sessionFixture,
  );
  assert.equal(editorResponse?.status, 403);

  const unauthenticatedResponse = await authorizeAdminOnlySessionToken(
    undefined,
    sessionFixture,
  );
  assert.equal(unauthenticatedResponse?.status, 401);
  assert.deepEqual(await unauthenticatedResponse?.json(), {
    error: "Authentication is required.",
  });
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
