import assert from "node:assert/strict";
import { test } from "node:test";
import nextConfig from "../next.config";

test("Work Experience alias redirects permanently to the canonical experience route", async () => {
  const getRedirects = nextConfig.redirects;
  assert.equal(typeof getRedirects, "function");
  if (!getRedirects) throw new Error("Redirect configuration is missing.");

  const redirects = await getRedirects();

  assert.deepEqual(
    redirects.find(({ source }) => source === "/work-experience"),
    {
      source: "/work-experience",
      destination: "/experience",
      permanent: true,
    },
  );
});
