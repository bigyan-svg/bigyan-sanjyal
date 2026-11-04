import assert from "node:assert/strict";
import { test } from "node:test";
import { navigateAfterAdminLogin } from "../src/lib/admin-login-flow";

test("successful login response navigates to the protected dashboard", async () => {
  const destinations: string[] = [];
  const response = Response.json({ success: true }, { status: 200 });

  const result = await navigateAfterAdminLogin(response, (path) => {
    destinations.push(path);
  });

  assert.equal(result, "navigated");
  assert.deepEqual(destinations, ["/admin"]);
});

test("non-success HTTP responses do not trigger dashboard navigation", async () => {
  const destinations: string[] = [];
  const response = Response.json({ error: "Invalid request." }, { status: 401 });

  const result = await navigateAfterAdminLogin(response, (path) => {
    destinations.push(path);
  });

  assert.equal(result, "rejected");
  assert.deepEqual(destinations, []);
});

test("an OK response without the documented success payload is rejected", async () => {
  const destinations: string[] = [];
  const responses = [
    new Response("not json", { status: 200 }),
    Response.json({ message: "ok" }, { status: 200 }),
    Response.json({ success: false }, { status: 200 }),
  ];

  for (const response of responses) {
    const result = await navigateAfterAdminLogin(response, (path) => {
      destinations.push(path);
    });
    assert.equal(result, "rejected");
  }

  assert.deepEqual(destinations, []);
});
