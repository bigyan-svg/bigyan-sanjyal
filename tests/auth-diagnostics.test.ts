import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAdminAuthDiagnostic,
  getSafeDatabaseTarget,
} from "../src/lib/auth/auth-diagnostics";

test("database diagnostic identifiers omit credentials and query parameters", () => {
  const target = getSafeDatabaseTarget(
    "postgresql://hidden-user:hidden-password@db.example.test:5433/portfolio_db?sslpassword=hidden-query",
  );

  assert.deepEqual(target, {
    host: "db.example.test",
    port: "5433",
    database: "portfolio_db",
  });
  assert.doesNotMatch(JSON.stringify(target), /hidden-user|hidden-password|hidden-query/u);
  assert.equal(getSafeDatabaseTarget("not a database URL"), null);
});

test("authentication diagnostics are disabled outside development", () => {
  assert.equal(
    formatAdminAuthDiagnostic(
      {
        boundary: "login-api",
        outcome: "accepted",
        phase: "password-verification",
      },
      null,
      "production",
    ),
    null,
  );
});

test("development diagnostics only emit the safe identity and allowlisted state", () => {
  const output = formatAdminAuthDiagnostic(
    {
      boundary: "login-cookie",
      outcome: "issued",
      cookieName: "admin_session",
      cookiePath: "/",
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      browserSession: true,
    },
    getSafeDatabaseTarget(
      "postgresql://hidden-user:hidden-password@localhost:5432/portfolio_db?secret=hidden-query",
    ),
    "development",
  );

  assert.ok(output);
  assert.match(output, /portfolio_db/u);
  assert.match(output, /admin_session/u);
  assert.doesNotMatch(output, /hidden-user|hidden-password|hidden-query/u);
});
