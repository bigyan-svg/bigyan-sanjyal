import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const isolatedLogoutTests = String.raw`
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const state = {
  cookiePresent: true,
  originAllowed: true,
  validationResult: { sessionId: "session-id-fixture" },
  updateResult: { count: 1 },
  updateError: undefined,
  cookieDeleteError: undefined,
  calls: {
    cookieReads: [],
    cookieDeletes: [],
    validationSources: [],
    updates: [],
  },
};

function resetState() {
  state.cookiePresent = true;
  state.originAllowed = true;
  state.validationResult = { sessionId: "session-id-fixture" };
  state.updateResult = { count: 1 };
  state.updateError = undefined;
  state.cookieDeleteError = undefined;
  state.calls.cookieReads.length = 0;
  state.calls.cookieDeletes.length = 0;
  state.calls.validationSources.length = 0;
  state.calls.updates.length = 0;
}

const cookieStore = {
  get(name) {
    state.calls.cookieReads.push(name);
    return name === "admin_session" && state.cookiePresent
      ? { value: "non-secret-test-fixture" }
      : undefined;
  },
  delete(name) {
    state.calls.cookieDeletes.push(name);
    if (state.cookieDeleteError) throw state.cookieDeleteError;
  },
};

mock.module("next/headers", {
  namedExports: { cookies: async () => cookieStore },
});
mock.module("@/lib/auth/origin", {
  namedExports: { hasTrustedRequestOrigin: () => state.originAllowed },
});
mock.module("@/lib/auth/session", {
  namedExports: {
    validateAdminSession: async (_token, source) => {
      state.calls.validationSources.push(source);
      return state.validationResult;
    },
  },
});
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      adminSession: {
        updateMany: async (args) => {
          state.calls.updates.push(args);
          if (state.updateError) throw state.updateError;
          return state.updateResult;
        },
      },
    },
  },
});
mock.module("@/lib/auth/auth-diagnostics", {
  namedExports: { logAdminAuthDiagnostic() {} },
});

const { POST } = await import("./src/app/api/auth/logout/route.ts");
const makeRequest = () =>
  new Request("https://example.test/api/auth/logout", {
    method: "POST",
    headers: { Origin: "https://example.test" },
  });

test("successful logout revokes the active session and clears its cookie", async () => {
  resetState();
  const response = await POST(makeRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(state.calls.cookieReads, ["admin_session"]);
  assert.deepEqual(state.calls.validationSources, ["logout"]);
  assert.deepEqual(state.calls.cookieDeletes, ["admin_session"]);
  assert.equal(state.calls.updates.length, 1);
  assert.deepEqual(state.calls.updates[0].where, {
    id: "session-id-fixture",
    revokedAt: null,
  });
  assert.ok(state.calls.updates[0].data.revokedAt instanceof Date);
});

test("a missing session is handled safely and the cookie is still cleared", async () => {
  resetState();
  state.cookiePresent = false;
  state.validationResult = null;

  const response = await POST(makeRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(state.calls.cookieReads, ["admin_session"]);
  assert.deepEqual(state.calls.validationSources, []);
  assert.deepEqual(state.calls.updates, []);
  assert.deepEqual(state.calls.cookieDeletes, ["admin_session"]);
});

test("invalid or expired sessions are not preserved and their cookie is cleared", async () => {
  for (const reason of ["invalid", "expired"]) {
    resetState();
    state.validationResult = null;

    const response = await POST(makeRequest());

    assert.equal(response.status, 200, reason);
    assert.deepEqual(await response.json(), { success: true }, reason);
    assert.deepEqual(state.calls.validationSources, ["logout"], reason);
    assert.deepEqual(state.calls.updates, [], reason);
    assert.deepEqual(state.calls.cookieDeletes, ["admin_session"], reason);
  }
});

test("a server-side revocation failure returns 500 and still clears the cookie", async () => {
  resetState();
  state.updateError = new Error("non-secret fixture failure");

  const response = await POST(makeRequest());

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to complete logout.",
  });
  assert.deepEqual(state.calls.cookieDeletes, ["admin_session"]);
  assert.equal(state.calls.updates.length, 1);
});

test("a cookie-clearing failure is reported after server-side revocation", async () => {
  resetState();
  state.cookieDeleteError = new Error("non-secret fixture failure");

  const response = await POST(makeRequest());

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Unable to complete logout.",
  });
  assert.equal(state.calls.updates.length, 1);
  assert.deepEqual(state.calls.cookieDeletes, ["admin_session"]);
});

test("an untrusted origin is rejected before session or cookie operations", async () => {
  resetState();
  state.originAllowed = false;

  const response = await POST(makeRequest());

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Unable to complete logout.",
  });
  assert.deepEqual(state.calls.cookieReads, []);
  assert.deepEqual(state.calls.validationSources, []);
  assert.deepEqual(state.calls.updates, []);
  assert.deepEqual(state.calls.cookieDeletes, []);
});

test("production session-cookie options retain required security attributes", async () => {
  const { getAdminSessionCookieOptions } = await import(
    "./src/lib/auth/session-cookie-options.ts"
  );

  assert.deepEqual(getAdminSessionCookieOptions(true), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
});
`;

test("admin logout route regression scenarios", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--conditions=react-server",
      "--import=tsx",
      "--input-type=module",
      "--eval",
      isolatedLogoutTests,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { NODE_ENV: "test" },
      timeout: 30_000,
      windowsHide: true,
    },
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, "Isolated logout-route tests failed.");
  assert.match(result.stdout, /# tests 7/u);
  assert.match(result.stdout, /# pass 7/u);
  assert.match(result.stdout, /# fail 0/u);
});
