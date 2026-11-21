import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_RATE_LIMIT_POLICIES,
  ProcessLocalLoginRateLimiter,
  type AdminLoginRateLimitBackend,
  createAdminLoginEmailPseudonym,
  checkAdminLoginRateLimit,
  checkAdminPasswordChangeRateLimit,
  checkContactSubmissionRateLimit,
  createRateLimitPseudonym,
  getTrustedClientIp,
} from "../src/lib/auth/login-rate-limit";
import { getRateLimitReadiness } from "../src/lib/auth/rate-limit-readiness";
import { createLoginRateLimitedResponse } from "../src/lib/auth/login-rate-limit-response";

const validProductionEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-token-not-used-for-network-access",
  ADMIN_RATE_LIMIT_HMAC_SECRET: "a-test-only-secret-that-is-at-least-32-bytes",
};

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/contact", { headers });
}

function saveEnvironment(names: readonly string[]) {
  const environment = process.env as Record<string, string | undefined>;
  const previous = new Map(names.map((name) => [name, environment[name]]));

  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete environment[name];
      else environment[name] = value;
    }
  };
}

function makeRateLimitBackend(
  onLimit: (limiter: string, identifier: string) => Promise<{
    success: boolean;
    reset: number;
    reason?: string;
  }> = async () => ({ success: true, reset: Date.now() + 60_000 }),
  calls: Record<string, string[]> = {},
): AdminLoginRateLimitBackend {
  const limiter = (name: string) => ({
    limit(identifier: string) {
      calls[name] ??= [];
      calls[name].push(identifier);
      return onLimit(name, identifier);
    },
  });

  return {
    hmacSecret: "test-only-secret-with-at-least-32-bytes",
    ipFifteenMinutes: limiter("ipFifteenMinutes"),
    ipOneHour: limiter("ipOneHour"),
    emailIpFifteenMinutes: limiter("emailIpFifteenMinutes"),
    emailFifteenMinutes: limiter("emailFifteenMinutes"),
    emailOneHour: limiter("emailOneHour"),
  };
}

function trustedLoginRequest(ip: string): Request {
  return new Request("https://example.test/api/auth/login", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

test("uses only the valid Vercel-provided client IP header on Vercel", () => {
  assert.equal(
    getTrustedClientIp(
      request({ "x-vercel-forwarded-for": "203.0.113.24" }),
      validProductionEnvironment,
    ),
    "203.0.113.24",
  );
  assert.equal(
    getTrustedClientIp(
      request({ "x-vercel-forwarded-for": "2001:db8::5" }),
      validProductionEnvironment,
    ),
    "2001:db8::5",
  );
});

test("missing or invalid trusted client IP maps to a safe unavailable reason", async () => {
  assert.deepEqual(
    await checkAdminLoginRateLimit(
      request(),
      "admin@example.test",
    ),
    { status: "unavailable", reason: "trusted_ip_missing" },
  );
});

test("fails closed when Vercel's trusted client IP header is missing or invalid", () => {
  assert.equal(
    getTrustedClientIp(
      request({ "x-forwarded-for": "203.0.113.24" }),
      validProductionEnvironment,
    ),
    null,
  );
  assert.equal(
    getTrustedClientIp(
      request({ "x-vercel-forwarded-for": "203.0.113.24, 198.51.100.2" }),
      validProductionEnvironment,
    ),
    null,
  );
  assert.equal(
    getTrustedClientIp(
      request({ "x-vercel-forwarded-for": "not-an-ip" }),
      validProductionEnvironment,
    ),
    null,
  );
});

test("rejects arbitrary client-supplied IP headers", () => {
  const arbitraryHeaders = request({
    "x-forwarded-for": "203.0.113.24",
    "x-real-ip": "203.0.113.25",
    "cf-connecting-ip": "203.0.113.26",
    "true-client-ip": "203.0.113.27",
  });

  assert.equal(
    getTrustedClientIp(arbitraryHeaders, {
      NODE_ENV: "production",
      VERCEL: "1",
    }),
    null,
  );
  assert.equal(
    getTrustedClientIp(arbitraryHeaders, {
      NODE_ENV: "production",
      VERCEL: "0",
    }),
    null,
  );
  assert.equal(
    getTrustedClientIp(
      request({ "x-vercel-forwarded-for": "203.0.113.28" }),
      { NODE_ENV: "production", VERCEL: "0" },
    ),
    null,
  );
});

test("non-Vercel production hosts have no trusted IP source", () => {
  assert.equal(
    getTrustedClientIp(
      request({ "x-forwarded-for": "203.0.113.24" }),
      { NODE_ENV: "production" },
    ),
    null,
  );
  const readiness = getRateLimitReadiness({ NODE_ENV: "production" });
  assert.equal(readiness.trustedClientIpPolicy, "unavailable");
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("unsupported-production-proxy"));
});

test("local development uses a shared identity without trusting supplied IP headers", () => {
  const headers = request({
    "x-forwarded-for": "203.0.113.24",
    "x-real-ip": "203.0.113.25",
    "cf-connecting-ip": "203.0.113.26",
  });
  assert.equal(
    getTrustedClientIp(headers, {
      NODE_ENV: "development",
      ENABLE_LOCAL_LOGIN_RATE_LIMIT: "true",
    }),
    "local-development",
  );
  assert.equal(
    getTrustedClientIp(request(), {
      NODE_ENV: "production",
      ENABLE_LOCAL_LOGIN_RATE_LIMIT: "true",
    }),
    null,
  );
});

test("readiness identifies missing Redis configuration without exposing values", () => {
  const readiness = getRateLimitReadiness({
    NODE_ENV: "production",
    VERCEL: "1",
  });

  assert.equal(readiness.redisUrlConfigured, false);
  assert.equal(readiness.redisTokenConfigured, false);
  assert.equal(readiness.redisConfigurationReady, false);
  assert.equal(readiness.ready, false);
  assert.ok(readiness.issues.includes("upstash-url-missing"));
  assert.ok(readiness.issues.includes("upstash-token-missing"));
  const diagnostic = JSON.stringify(readiness);
  assert.equal(diagnostic.includes("UPSTASH_REDIS_REST_TOKEN"), false);
  assert.equal(diagnostic.includes("https://example.upstash.io"), false);
  assert.equal(diagnostic.includes(validProductionEnvironment.UPSTASH_REDIS_REST_TOKEN), false);
  assert.equal(
    diagnostic.includes(validProductionEnvironment.ADMIN_RATE_LIMIT_HMAC_SECRET),
    false,
  );
});

test("readiness rejects malformed Redis URLs and missing or weak HMAC secrets", () => {
  const missingSecret = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: undefined,
  });
  assert.equal(missingSecret.hmacSecretConfigured, false);
  assert.equal(missingSecret.hmacSecretStrong, false);
  assert.ok(missingSecret.issues.includes("hmac-secret-missing"));

  const weakSecret = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: "short-secret",
  });
  assert.equal(weakSecret.hmacSecretStrong, false);
  assert.ok(weakSecret.issues.includes("hmac-secret-too-short"));

  const malformedUrl = getRateLimitReadiness({
    ...validProductionEnvironment,
    UPSTASH_REDIS_REST_URL: "not-a-url",
  });
  assert.equal(malformedUrl.redisUrlConfigured, true);
  assert.equal(malformedUrl.redisUrlValid, false);
  assert.ok(malformedUrl.issues.includes("upstash-url-invalid"));
});

test("HMAC secret minimum is measured in UTF-8 bytes", () => {
  const utf8 = new TextEncoder();
  const thirtyOneByteSecret = "a".repeat(31);
  const thirtyTwoByteAsciiSecret = "a".repeat(32);
  const thirtyTwoByteNonAsciiSecret = "é".repeat(16);
  const belowThirtyTwoByteSecret = "é".repeat(15);

  assert.equal(utf8.encode(thirtyOneByteSecret).byteLength, 31);
  assert.equal(utf8.encode(thirtyTwoByteAsciiSecret).byteLength, 32);
  assert.ok(thirtyTwoByteNonAsciiSecret.length < 32);
  assert.equal(utf8.encode(thirtyTwoByteNonAsciiSecret).byteLength, 32);
  assert.ok(utf8.encode(belowThirtyTwoByteSecret).byteLength < 32);

  const thirtyOneByteReadiness = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: thirtyOneByteSecret,
  });
  assert.equal(thirtyOneByteReadiness.hmacSecretStrong, false);
  assert.ok(thirtyOneByteReadiness.issues.includes("hmac-secret-too-short"));

  const thirtyTwoByteAsciiReadiness = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: thirtyTwoByteAsciiSecret,
  });
  assert.equal(thirtyTwoByteAsciiReadiness.hmacSecretStrong, true);

  const thirtyTwoByteNonAsciiReadiness = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: thirtyTwoByteNonAsciiSecret,
  });
  assert.equal(thirtyTwoByteNonAsciiReadiness.hmacSecretStrong, true);

  const belowThirtyTwoByteReadiness = getRateLimitReadiness({
    ...validProductionEnvironment,
    ADMIN_RATE_LIMIT_HMAC_SECRET: belowThirtyTwoByteSecret,
  });
  assert.equal(belowThirtyTwoByteReadiness.hmacSecretStrong, false);
  assert.ok(belowThirtyTwoByteReadiness.issues.includes("hmac-secret-too-short"));
});

test("configured direct Vercel and Upstash settings report ready", () => {
  const readiness = getRateLimitReadiness(validProductionEnvironment);

  assert.equal(readiness.trustedClientIpPolicy, "vercel-edge-direct-ingress-only");
  assert.equal(readiness.redisConfigurationReady, true);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.issues, []);
});

test("local development login readiness uses the process-local backend without secrets", () => {
  const readiness = getRateLimitReadiness({ NODE_ENV: "development" });

  assert.equal(readiness.loginRateLimitBackend, "process-local");
  assert.equal(readiness.loginReady, true);
  assert.equal(readiness.redisConfigurationReady, false);
  assert.equal(readiness.ready, false);
});

test("login, password-change, and contact limiters fail closed without Upstash configuration", async () => {
  const restore = saveEnvironment([
    "NODE_ENV",
    "VERCEL",
    "VERCEL_ENV",
    "ENABLE_LOCAL_LOGIN_RATE_LIMIT",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ADMIN_RATE_LIMIT_HMAC_SECRET",
  ]);

  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";
  environment.VERCEL_ENV = "preview";
  delete environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT;
  delete environment.UPSTASH_REDIS_REST_URL;
  delete environment.UPSTASH_REDIS_REST_TOKEN;
  delete environment.ADMIN_RATE_LIMIT_HMAC_SECRET;

  try {
    const trustedRequest = request({ "x-vercel-forwarded-for": "203.0.113.24" });
    assert.deepEqual(await checkAdminLoginRateLimit(trustedRequest, "admin@example.test"), {
      status: "unavailable",
      reason: "redis_configuration_missing",
    });
    assert.deepEqual(await checkAdminPasswordChangeRateLimit(trustedRequest, "test-admin-id"), {
      status: "unavailable",
      reason: "redis_configuration_missing",
    });
    assert.deepEqual(await checkContactSubmissionRateLimit(trustedRequest), {
      status: "unavailable",
      reason: "redis_configuration_missing",
    });
    const previewReadiness = getRateLimitReadiness({
      NODE_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    });
    assert.equal(previewReadiness.loginRateLimitBackend, "unavailable");
    assert.equal(previewReadiness.loginReady, false);
  } finally {
    restore();
  }
});

test("rate-limit identifiers are stable keyed pseudonyms and scope separated", () => {
  const ip = "203.0.113.24";
  const secret = "test-only-secret-with-at-least-32-bytes";
  const first = createRateLimitPseudonym(secret, "ip", ip);

  assert.equal(first, createRateLimitPseudonym(secret, "ip", ip));
  assert.notEqual(first, createRateLimitPseudonym(secret, "contact-ip", ip));
  assert.notEqual(first, createRateLimitPseudonym(`${secret}-different`, "ip", ip));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, ip);
});

test("account-scoped login pseudonyms normalize email and omit client IP", () => {
  const secret = "test-only-secret-with-at-least-32-bytes";
  const normalized = createAdminLoginEmailPseudonym(secret, "admin@example.test");
  assert.equal(
    normalized,
    createAdminLoginEmailPseudonym(secret, " ADMIN@example.test "),
  );
  assert.notEqual(normalized, "admin@example.test");
  assert.notEqual(
    normalized,
    createRateLimitPseudonym(
      secret,
      "email-ip",
      ["admin@example.test", "203.0.113.24"].join("\0"),
    ),
  );
});

test("login account buckets are shared across IPs and isolated between emails", async () => {
  const restore = saveEnvironment(["NODE_ENV", "VERCEL"]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";
  const calls: Record<string, string[]> = {};
  const backend = makeRateLimitBackend(undefined, calls);

  try {
    await checkAdminLoginRateLimit(
      trustedLoginRequest("203.0.113.1"),
      "Admin@example.test",
      backend,
    );
    await checkAdminLoginRateLimit(
      trustedLoginRequest("203.0.113.2"),
      " admin@EXAMPLE.test ",
      backend,
    );
    await checkAdminLoginRateLimit(
      trustedLoginRequest("203.0.113.3"),
      "other@example.test",
      backend,
    );

    assert.equal(calls.emailFifteenMinutes[0], calls.emailFifteenMinutes[1]);
    assert.equal(calls.emailOneHour[0], calls.emailOneHour[1]);
    assert.notEqual(calls.emailFifteenMinutes[0], calls.emailFifteenMinutes[2]);
    assert.notEqual(calls.emailOneHour[0], calls.emailOneHour[2]);
    assert.notEqual(calls.ipFifteenMinutes[0], calls.ipFifteenMinutes[1]);
    assert.notEqual(calls.emailIpFifteenMinutes[0], calls.emailIpFifteenMinutes[1]);
    assert.ok(
      Object.values(calls).flat().every((identifier) => /^[a-f0-9]{64}$/u.test(identifier)),
    );
    assert.equal(
      Object.values(calls).flat().some((identifier) => identifier.includes("@")),
      false,
    );
  } finally {
    restore();
  }
});

test("account buckets enforce the configured 15-minute and hourly boundaries", async () => {
  const restore = saveEnvironment(["NODE_ENV", "VERCEL"]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";

  const runAttempts = async (
    targetLimiter: "emailFifteenMinutes" | "emailOneHour",
    limit: number,
  ) => {
    const counters = new Map<string, number>();
    const backend = makeRateLimitBackend(async (limiterName, identifier) => {
      if (limiterName !== targetLimiter) {
        return { success: true, reset: Date.now() + 60_000 };
      }

      const count = (counters.get(identifier) ?? 0) + 1;
      counters.set(identifier, count);
      return { success: count <= limit, reset: Date.now() + 60_000 };
    });

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      assert.deepEqual(
        await checkAdminLoginRateLimit(
          trustedLoginRequest(`203.0.113.${attempt}`),
          "shared@example.test",
          backend,
        ),
        { status: "allowed" },
      );
    }

    const blocked = await checkAdminLoginRateLimit(
      trustedLoginRequest("203.0.114.1"),
      "shared@example.test",
      backend,
    );
    assert.equal(blocked.status, "limited");
    if (blocked.status === "limited") {
      assert.ok(blocked.retryAfterSeconds > 0);
    }
  };

  try {
    await runAttempts(
      "emailFifteenMinutes",
      ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailFifteenMinutes.limit,
    );
    await runAttempts(
      "emailOneHour",
      ADMIN_RATE_LIMIT_POLICIES.adminLoginEmailOneHour.limit,
    );
  } finally {
    restore();
  }
});

test("login rate limiting fails closed for Redis errors and timeout decisions", async () => {
  const restore = saveEnvironment(["NODE_ENV", "VERCEL"]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";

  try {
    const rejectingBackend = makeRateLimitBackend(async (limiterName) => {
      if (limiterName === "emailFifteenMinutes") {
        throw new Error("private Redis failure");
      }
      return { success: true, reset: Date.now() + 60_000 };
    });

    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.9"),
        "admin@example.test",
        rejectingBackend,
      ),
      { status: "unavailable", reason: "redis_command_error" },
    );

    const timeoutBackend = makeRateLimitBackend(async (limiterName) => ({
      success: true,
      reset: Date.now() + 60_000,
      ...(limiterName === "emailOneHour" ? { reason: "timeout" } : {}),
    }));
    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.9"),
        "admin@example.test",
        timeoutBackend,
      ),
      { status: "unavailable", reason: "redis_timeout" },
    );
  } finally {
    restore();
  }
});

test("login rate limiting distinguishes invalid Redis configuration and connection failures", async () => {
  const restoreEnvironment = saveEnvironment([
    "NODE_ENV",
    "VERCEL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ADMIN_RATE_LIMIT_HMAC_SECRET",
  ]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";

  try {
    environment.UPSTASH_REDIS_REST_URL = "not-a-url";
    environment.UPSTASH_REDIS_REST_TOKEN = "configured-token";
    environment.ADMIN_RATE_LIMIT_HMAC_SECRET =
      "a-test-only-secret-that-is-at-least-32-bytes";

    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.9"),
        "admin@example.test",
      ),
      { status: "unavailable", reason: "redis_url_invalid" },
    );

    environment.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    environment.ADMIN_RATE_LIMIT_HMAC_SECRET = "short-secret";
    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.9"),
        "admin@example.test",
      ),
      { status: "unavailable", reason: "admin_hmac_secret_invalid" },
    );

    const connectionError = Object.assign(new Error("private"), {
      code: "ECONNREFUSED",
    });
    const connectionBackend = makeRateLimitBackend(async () => {
      throw connectionError;
    });
    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.9"),
        "admin@example.test",
        connectionBackend,
      ),
      { status: "unavailable", reason: "redis_connection_error" },
    );

    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
    ]) {
      const nestedConnectionError = new Error("private outer error", {
        cause: Object.assign(new Error("private nested error"), { code }),
      });
      const nestedConnectionBackend = makeRateLimitBackend(async () => {
        throw nestedConnectionError;
      });
      assert.deepEqual(
        await checkAdminLoginRateLimit(
          trustedLoginRequest("203.0.113.10"),
          "admin@example.test",
          nestedConnectionBackend,
        ),
        { status: "unavailable", reason: "redis_connection_error" },
        `${code} nested cause`,
      );
    }

    for (const code of ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]) {
      const nestedTimeoutError = new Error("private outer error", {
        cause: Object.assign(new Error("private nested error"), { code }),
      });
      const nestedTimeoutBackend = makeRateLimitBackend(async () => {
        throw nestedTimeoutError;
      });
      assert.deepEqual(
        await checkAdminLoginRateLimit(
          trustedLoginRequest("203.0.113.12"),
          "admin@example.test",
          nestedTimeoutBackend,
        ),
        { status: "unavailable", reason: "redis_timeout" },
        `${code} nested timeout cause`,
      );
    }

    const circularConnectionError = Object.assign(
      new Error("private outer error"),
      { code: "ECONNREFUSED" },
    );
    (circularConnectionError as Error & { cause?: unknown }).cause =
      circularConnectionError;
    const circularConnectionBackend = makeRateLimitBackend(async () => {
      throw circularConnectionError;
    });
    assert.deepEqual(
      await checkAdminLoginRateLimit(
        trustedLoginRequest("203.0.113.11"),
        "admin@example.test",
        circularConnectionBackend,
      ),
      { status: "unavailable", reason: "redis_connection_error" },
    );
  } finally {
    restoreEnvironment();
  }
});

test("existing IP and email-plus-IP login buckets still enforce limits", async () => {
  const restore = saveEnvironment(["NODE_ENV", "VERCEL"]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "production";
  environment.VERCEL = "1";

  try {
    for (const limitedLimiter of ["ipFifteenMinutes", "emailIpFifteenMinutes"]) {
      const calls: Record<string, string[]> = {};
      const backend = makeRateLimitBackend(async (limiterName) => ({
        success: limiterName !== limitedLimiter,
        reset: Date.now() + 60_000,
      }), calls);

      assert.equal(
        (await checkAdminLoginRateLimit(
          trustedLoginRequest("203.0.113.11"),
          "admin@example.test",
          backend,
        )).status,
        "limited",
      );
      assert.match(calls[limitedLimiter][0], /^[a-f0-9]{64}$/u);
    }
  } finally {
    restore();
  }
});

test("login throttling returns the generic no-store 429 response", async () => {
  const response = createLoginRateLimitedResponse(45);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "45");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "Too many sign-in attempts. Please try again later.",
  });
});

test("login rate-limit thresholds, windows, and namespaces are explicit", () => {
  assert.deepEqual(ADMIN_RATE_LIMIT_POLICIES, {
    adminLoginIpFifteenMinutes: {
      limit: 10,
      window: "15 m",
      prefix: "admin-login:ip:15m",
    },
    adminLoginIpOneHour: {
      limit: 30,
      window: "1 h",
      prefix: "admin-login:ip:1h",
    },
    adminLoginEmailIpFifteenMinutes: {
      limit: 10,
      window: "15 m",
      prefix: "admin-login:email-ip:15m",
    },
    adminLoginEmailFifteenMinutes: {
      limit: 10,
      window: "15 m",
      prefix: "admin-login:email:15m",
    },
    adminLoginEmailOneHour: {
      limit: 30,
      window: "1 h",
      prefix: "admin-login:email:1h",
    },
    adminPasswordChangeIpFifteenMinutes: {
      limit: 5,
      window: "15 m",
      prefix: "admin-password-change:admin-ip:15m",
    },
    contactIpFifteenMinutes: {
      limit: 5,
      window: "15 m",
      prefix: "contact-submit:ip:15m",
    },
    contactIpOneHour: {
      limit: 20,
      window: "1 h",
      prefix: "contact-submit:ip:1h",
    },
  });
});

test("local development login is rate limited without Redis and ignores spoofed IP headers", async () => {
  const restore = saveEnvironment([
    "NODE_ENV",
    "VERCEL",
    "VERCEL_ENV",
    "ENABLE_LOCAL_LOGIN_RATE_LIMIT",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ADMIN_RATE_LIMIT_HMAC_SECRET",
  ]);
  const environment = process.env as Record<string, string | undefined>;
  environment.NODE_ENV = "development";
  delete environment.VERCEL;
  delete environment.VERCEL_ENV;
  delete environment.ENABLE_LOCAL_LOGIN_RATE_LIMIT;
  delete environment.UPSTASH_REDIS_REST_URL;
  delete environment.UPSTASH_REDIS_REST_TOKEN;
  delete environment.ADMIN_RATE_LIMIT_HMAC_SECRET;

  try {
    for (
      let attempt = 1;
      attempt <= ADMIN_RATE_LIMIT_POLICIES.adminLoginIpFifteenMinutes.limit;
      attempt += 1
    ) {
      assert.deepEqual(
        await checkAdminLoginRateLimit(
          request({
            "x-forwarded-for": `203.0.113.${attempt}`,
            "x-real-ip": `198.51.100.${attempt}`,
            "cf-connecting-ip": `192.0.2.${attempt}`,
          }),
          "LocalAdmin@example.test",
        ),
        { status: "allowed" },
      );
    }

    const blocked = await checkAdminLoginRateLimit(
      request({
        "x-forwarded-for": "192.0.2.200",
        "x-real-ip": "192.0.2.201",
      }),
      " localadmin@EXAMPLE.test ",
    );
    assert.equal(blocked.status, "limited");
    if (blocked.status === "limited") {
      assert.ok(blocked.retryAfterSeconds > 0);
      assert.ok(blocked.retryAfterSeconds <= 900);
    }
  } finally {
    restore();
  }
});

test("process-local login limiter preserves the per-window thresholds", () => {
  let now = 1_000_000;
  const limiter = new ProcessLocalLoginRateLimiter(
    "test-only-local-rate-limit-secret",
    100,
    () => now,
  );

  for (let period = 0; period < 3; period += 1) {
    if (period > 0) now += 15 * 60 * 1_000 + 1;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.deepEqual(limiter.limit("same-admin@example.test"), {
        status: "allowed",
      });
    }
  }

  const blocked = limiter.limit("same-admin@example.test");
  assert.equal(blocked.status, "limited");
  if (blocked.status === "limited") {
    assert.ok(blocked.retryAfterSeconds > 0);
    assert.ok(blocked.retryAfterSeconds <= 60 * 60);
  }
});

test("process-local account capacity preserves active windows and frees expired entries", () => {
  let now = 1_000_000;
  const limiter = new ProcessLocalLoginRateLimiter(
    "test-only-local-rate-limit-secret",
    1,
    () => now,
  );

  assert.deepEqual(limiter.limit("first-admin@example.test"), {
    status: "allowed",
  });

  now += 15 * 60 * 1_000 + 1;
  const whileAccountWindowIsActive = limiter.limit("second-admin@example.test");
  assert.equal(whileAccountWindowIsActive.status, "limited");
  if (whileAccountWindowIsActive.status === "limited") {
    assert.ok(whileAccountWindowIsActive.retryAfterSeconds > 0);
    assert.ok(whileAccountWindowIsActive.retryAfterSeconds <= 60 * 60);
  }

  now += 45 * 60 * 1_000 + 1;
  assert.deepEqual(limiter.limit("second-admin@example.test"), {
    status: "allowed",
  });
});

test("shared local blocking does not allocate another account entry", () => {
  let now = 1_000_000;
  const limiter = new ProcessLocalLoginRateLimiter(
    "test-only-local-rate-limit-secret",
    11,
    () => now,
  );

  for (let account = 0; account < 10; account += 1) {
    assert.deepEqual(limiter.limit(`admin-${account}@example.test`), {
      status: "allowed",
    });
  }
  assert.equal(limiter.limit("blocked-admin@example.test").status, "limited");

  now += 15 * 60 * 1_000 + 1;
  assert.deepEqual(limiter.limit("next-admin@example.test"), {
    status: "allowed",
  });
});
