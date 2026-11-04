import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

test("public routes pass through the proxy without admin authentication redirects", () => {
  const response = proxy(new NextRequest("https://site.example/about"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(
    response.headers.get("Strict-Transport-Security"),
    process.env.NODE_ENV === "production" ? "max-age=31536000" : null,
  );
});

test("admin routes retain their existing unauthenticated redirect behavior", () => {
  const response = proxy(new NextRequest("https://site.example/admin"));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")!).pathname, "/admin/login");
});
