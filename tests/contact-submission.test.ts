import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContactSubmissionRateLimit } from "../src/lib/auth/login-rate-limit";
import { hasTrustedRequestOrigin } from "../src/lib/auth/origin";
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_REQUEST_MAX_BYTES,
  CONTACT_SUBJECT_MAX_LENGTH,
  handleContactSubmission,
  type NewContactMessageInput,
  type ContactSubmissionDependencies,
} from "../src/lib/contact-submission";

const TRUSTED_ORIGIN = "https://example.test";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Ada Lovelace",
    email: "ada@example.test",
    subject: "A question",
    message: "Hello there.",
    ...overrides,
  };
}

function makeRequest(
  body: unknown,
  options: { origin?: string; contentType?: string; rawBody?: string } = {},
): Request {
  const headers = new Headers();
  if (options.origin !== undefined) headers.set("Origin", options.origin);
  else headers.set("Origin", TRUSTED_ORIGIN);
  headers.set("Content-Type", options.contentType ?? "application/json; charset=utf-8");

  const serializedBody = options.rawBody ?? JSON.stringify(body);
  headers.set("Content-Length", String(Buffer.byteLength(serializedBody, "utf8")));
  return new Request("https://example.test/api/contact", {
    method: "POST",
    headers,
    body: serializedBody,
  });
}

function createDependencies(overrides: Partial<ContactSubmissionDependencies> = {}) {
  const saved: NewContactMessageInput[] = [];
  const calls = { rateLimit: 0 };
  const dependencies: ContactSubmissionDependencies = {
    isTrustedOrigin: (request) => request.headers.get("origin") === TRUSTED_ORIGIN,
    checkRateLimit: async () => {
      calls.rateLimit += 1;
      return { status: "allowed" };
    },
    createMessage: async (input) => {
      saved.push(input);
    },
    ...overrides,
  };
  return { dependencies, saved, calls };
}

test("accepts a valid message, normalizes values, and does not return submitted data", async () => {
  const { dependencies, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody({
      name: "  Ada   Lovelace  ",
      email: "  ADA@EXAMPLE.TEST  ",
      subject: "  A   question  ",
      message: "  First line.\r\nSecond line.  ",
    })),
    dependencies,
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(saved, [{
    name: "Ada Lovelace",
    email: "ada@example.test",
    subject: "A question",
    message: "First line.\nSecond line.",
    status: "NEW",
  }]);
});

test("rejects missing required fields", async () => {
  const { dependencies, saved } = createDependencies();
  const response = await handleContactSubmission(makeRequest({}), dependencies);
  const result = await response.json();

  assert.equal(response.status, 422);
  assert.deepEqual(result, {
    error: "Please correct the highlighted fields.",
    fields: {
      name: "Enter your name.",
      email: "Enter your email address.",
      message: "Enter a message.",
    },
  });
  assert.deepEqual(saved, []);
});

test("rejects invalid email addresses", async () => {
  const { dependencies, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody({ email: "ada at example.test" })),
    dependencies,
  );

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Please correct the highlighted fields.",
    fields: { email: "Enter a valid email address." },
  });
  assert.deepEqual(saved, []);
});

test("enforces database-compatible field lengths and a bounded message length", async () => {
  const overlongInputs = [
    { name: "n".repeat(CONTACT_NAME_MAX_LENGTH + 1) },
    { email: `${"a".repeat(CONTACT_EMAIL_MAX_LENGTH)}@example.test` },
    { subject: "s".repeat(CONTACT_SUBJECT_MAX_LENGTH + 1) },
    { message: "m".repeat(CONTACT_MESSAGE_MAX_LENGTH + 1) },
  ];
  const expectedFields = ["name", "email", "subject", "message"];

  for (const [index, override] of overlongInputs.entries()) {
    const { dependencies, saved } = createDependencies();
    const response = await handleContactSubmission(
      makeRequest(validBody(override)),
      dependencies,
    );
    const result = await response.json();

    assert.equal(response.status, 422);
    assert.ok(
      typeof result === "object" && result !== null && "fields" in result &&
        typeof result.fields === "object" && result.fields !== null &&
        expectedFields[index] in result.fields,
    );
    assert.deepEqual(saved, []);
  }
});

test("rejects request bodies larger than the configured byte limit", async () => {
  const { dependencies, calls, saved } = createDependencies();
  const rawBody = JSON.stringify({ ...validBody(), message: "x".repeat(CONTACT_REQUEST_MAX_BYTES) });
  const response = await handleContactSubmission(
    makeRequest(null, { rawBody }),
    dependencies,
  );

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
  assert.equal(calls.rateLimit, 0);
  assert.deepEqual(saved, []);
});

test("rejects unexpected fields", async () => {
  const { dependencies, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody({ admin: true })),
    dependencies,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid message data." });
  assert.deepEqual(saved, []);
});

test("silently accepts honeypot submissions without storing a message", async () => {
  const { dependencies, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody({ website: "https://spam.example" })),
    dependencies,
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { success: true });
  assert.deepEqual(saved, []);
});

test("rejects requests from untrusted Origins before rate limiting or persistence", async () => {
  const { dependencies, calls, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody(), { origin: "https://attacker.example" }),
    dependencies,
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request." });
  assert.equal(calls.rateLimit, 0);
  assert.deepEqual(saved, []);
});

test("the shared Origin helper accepts only the configured local development Origin", () => {
  const environment = process.env as Record<string, string | undefined>;
  const originalNodeEnv = environment.NODE_ENV;
  const originalVercel = environment.VERCEL;

  environment.NODE_ENV = "development";
  delete environment.VERCEL;
  try {
    const trustedRequest = new Request("http://localhost:3000/api/contact", {
      headers: { Origin: "http://localhost:3000" },
    });
    const untrustedRequest = new Request("http://localhost:3000/api/contact", {
      headers: { Origin: "https://attacker.example" },
    });

    assert.equal(hasTrustedRequestOrigin(trustedRequest), true);
    assert.equal(hasTrustedRequestOrigin(untrustedRequest), false);
  } finally {
    if (originalNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = originalNodeEnv;
    if (originalVercel === undefined) delete environment.VERCEL;
    else environment.VERCEL = originalVercel;
  }
});

test("requires the JSON content type", async () => {
  const { dependencies, calls, saved } = createDependencies();
  const response = await handleContactSubmission(
    makeRequest(validBody(), { contentType: "text/plain" }),
    dependencies,
  );

  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json." });
  assert.equal(calls.rateLimit, 0);
  assert.deepEqual(saved, []);
});

test("rejects rate-limited submissions and provides a safe retry interval", async () => {
  const { dependencies, saved } = createDependencies({
    checkRateLimit: async () => ({ status: "limited", retryAfterSeconds: 60 }),
  });
  const response = await handleContactSubmission(makeRequest(validBody()), dependencies);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "Too many submissions. Please try again later." });
  assert.deepEqual(saved, []);
});

test("fails closed when the rate limiter is unavailable or throws", async () => {
  for (const checkRateLimit of [
    async () => ({ status: "unavailable" as const }),
    async () => { throw new Error("private Redis detail"); },
  ]) {
    const { dependencies, saved } = createDependencies({ checkRateLimit });
    const response = await handleContactSubmission(makeRequest(validBody()), dependencies);

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "Message submission is temporarily unavailable. Please try again later.",
    });
    assert.deepEqual(saved, []);
  }
});

test("the shared contact limiter fails closed without a trusted client identity", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const originalNodeEnv = environment.NODE_ENV;
  const originalVercel = environment.VERCEL;
  const originalLocalLimit = environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT;

  environment.NODE_ENV = "production";
  delete environment.VERCEL;
  delete environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT;
  try {
    const request = new Request("https://example.test/api/contact", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    assert.deepEqual(await checkContactSubmissionRateLimit(request), { status: "unavailable" });
  } finally {
    if (originalNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = originalNodeEnv;
    if (originalVercel === undefined) delete environment.VERCEL;
    else environment.VERCEL = originalVercel;
    if (originalLocalLimit === undefined) delete environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT;
    else environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT = originalLocalLimit;
  }
});

test("returns a safe no-store error when persistence fails", async () => {
  const { dependencies } = createDependencies({
    createMessage: async () => {
      throw new Error("private database detail");
    },
  });
  const response = await handleContactSubmission(makeRequest(validBody()), dependencies);
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(body, JSON.stringify({ error: "Unable to submit your message. Please try again later." }));
  assert.equal(body.includes("private database detail"), false);
});
