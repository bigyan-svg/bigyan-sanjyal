import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getStrictTransportSecurityHeader,
  SECURITY_HEADERS,
} from "../src/lib/security-headers";

test("baseline security headers avoid CSP and preserve cross-origin link behavior", () => {
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

test("HSTS is applied only to production HTTPS requests", () => {
  assert.equal(getStrictTransportSecurityHeader("production", "https:"), "max-age=31536000");
  assert.equal(getStrictTransportSecurityHeader("production", "http:"), null);
  assert.equal(getStrictTransportSecurityHeader("development", "https:"), null);
});
