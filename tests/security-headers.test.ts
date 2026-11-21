import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config";
import {
  CSP_REPORT_ONLY_ENABLED,
  CSP_REPORT_ONLY_POLICY,
  getSecurityHeaders,
  getStrictTransportSecurityHeader,
  SECURITY_HEADERS,
} from "../src/lib/security-headers";

const EXPECTED_CSP_REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self'",
].join("; ");

test("baseline security headers retain their current values", () => {
  assert.deepEqual(
    SECURITY_HEADERS,
    [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ],
  );
  assert.equal(JSON.stringify(SECURITY_HEADERS).includes("Content-Security-Policy"), false);
});

test("CSP monitoring is configurable and uses only the Report-Only header", () => {
  assert.equal(CSP_REPORT_ONLY_ENABLED, true);
  assert.equal(CSP_REPORT_ONLY_POLICY, EXPECTED_CSP_REPORT_ONLY_POLICY);
  assert.deepEqual(getSecurityHeaders().at(-1), {
    key: "Content-Security-Policy-Report-Only",
    value: EXPECTED_CSP_REPORT_ONLY_POLICY,
  });
  assert.equal(
    getSecurityHeaders().some(({ key }) => key === "Content-Security-Policy"),
    false,
  );
  assert.doesNotMatch(CSP_REPORT_ONLY_POLICY, /nonce|unsafe-inline|unsafe-eval/iu);
});

test("disabling CSP monitoring leaves the existing security headers unchanged", () => {
  assert.deepEqual(getSecurityHeaders(false), SECURITY_HEADERS);
});

test("Next applies the monitoring header without changing PPR settings", async () => {
  const rules = await nextConfig.headers?.();
  assert.ok(rules);

  const matchingRule = rules.find(({ source }) => source === "/:path*");
  assert.ok(matchingRule);
  assert.deepEqual(
    matchingRule.headers.find(
      ({ key }) => key === "Content-Security-Policy-Report-Only",
    ),
    {
      key: "Content-Security-Policy-Report-Only",
      value: EXPECTED_CSP_REPORT_ONLY_POLICY,
    },
  );
  assert.equal(
    matchingRule.headers.some(({ key }) => key === "Content-Security-Policy"),
    false,
  );
  assert.equal(nextConfig.cacheComponents, true);
  assert.equal(nextConfig.partialPrefetching, true);
});

test("HSTS is applied only to production HTTPS requests", () => {
  assert.equal(getStrictTransportSecurityHeader("production", "https:"), "max-age=31536000");
  assert.equal(getStrictTransportSecurityHeader("production", "http:"), null);
  assert.equal(getStrictTransportSecurityHeader("development", "https:"), null);
});
