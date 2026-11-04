import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  handleSocialLinkCreate,
  handleSocialLinkDelete,
  handleSocialLinkList,
  handleSocialLinkReorder,
  handleSocialLinkUpdate,
} from "../src/lib/profile-social-management";
import {
  reorderProfileSocialLinksInTransaction,
  SocialLinkWriteConflictError,
} from "../src/lib/profile-social-content";
import {
  parseCreateSocialLink,
  parseSocialLinkPatch,
  parseSocialLinkReorder,
  filterSafePublicSocialLinks,
  resolveNextSocialLinkSortOrder,
  SOCIAL_LINK_LABEL_MAX_LENGTH,
  SOCIAL_LINK_MAX_COUNT,
  SOCIAL_LINK_SORT_ORDER_MAX,
  SOCIAL_LINK_URL_MAX_LENGTH,
  type AdminSocialLink,
  type SocialLinkInput,
} from "../src/lib/profile-social-validation";
import { hasProfileUnsavedChanges } from "../src/lib/profile-form-state";
import { publicSiteProfileQuery } from "../src/lib/public-site-profile-query";
import { hasTrustedRequestOrigin } from "../src/lib/auth/origin";

const TRUSTED_ORIGIN = "https://example.test";
const LINK_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_LINK_ID = "22222222-2222-4222-8222-222222222222";

function request(
  path: string,
  method: string,
  body?: unknown,
  options: { origin?: string | null; contentType?: string | null; rawBody?: string } = {},
): Request {
  const headers = new Headers();
  if (options.origin !== null) headers.set("Origin", options.origin ?? TRUSTED_ORIGIN);
  if (options.contentType !== null) {
    headers.set("Content-Type", options.contentType ?? "application/json");
  }
  const serialized = options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  if (serialized !== undefined) {
    headers.set("Content-Length", String(Buffer.byteLength(serialized, "utf8")));
  }

  return new Request(`https://example.test${path}`, {
    method,
    headers,
    ...(serialized === undefined ? {} : { body: serialized }),
  });
}

function link(overrides: Partial<AdminSocialLink> = {}): AdminSocialLink {
  return {
    id: LINK_ID,
    label: "Portfolio",
    url: "https://example.test/profile",
    sortOrder: 0,
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const calls = { findAll: 0, create: 0, update: 0, delete: 0, reorder: 0 };
  const values = {
    authorize: async () => null as Response | null,
    findAll: async () => {
      calls.findAll += 1;
      return [link()];
    },
    create: async (data: SocialLinkInput) => {
      calls.create += 1;
      return link(data);
    },
    update: async (_id: string, patch: Partial<SocialLinkInput>) => {
      calls.update += 1;
      return { kind: "updated" as const, link: link(patch) };
    },
    delete: async () => {
      calls.delete += 1;
      return true;
    },
    reorder: async () => {
      calls.reorder += 1;
      return true;
    },
    ...overrides,
  };
  return { calls, values };
}

test("normalizes labels and safe HTTPS URLs", () => {
  assert.deepEqual(parseCreateSocialLink({
    label: "  Developer   profile  ",
    url: " HTTPS://Example.Test:443/my-profile ",
  }), {
    data: {
      label: "Developer profile",
      url: "https://example.test/my-profile",
    },
    errors: {},
  });
});

test("rejects unsupported protocols, credentials, and invalid URLs", () => {
  for (const url of [
    "http://example.test/profile",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:password@example.test/profile",
    "not a URL",
  ]) {
    const result = parseCreateSocialLink({ label: "Portfolio", url });
    assert.equal(result.data, null);
    assert.ok(result.errors.url);
  }
});

test("requires valid label and URL fields within database-compatible limits", () => {
  for (const body of [
    {},
    { label: "", url: "https://example.test" },
    { label: "Portfolio", url: "" },
    { label: "x".repeat(SOCIAL_LINK_LABEL_MAX_LENGTH + 1), url: "https://example.test" },
    { label: "Portfolio", url: `https://example.test/${"x".repeat(SOCIAL_LINK_URL_MAX_LENGTH)}` },
    { label: 3, url: "https://example.test" },
  ]) {
    const result = parseCreateSocialLink(body);
    assert.equal(result.data, null);
    assert.ok(Object.keys(result.errors).length > 0);
  }
});

test("rejects unknown fields and empty or invalid patches", () => {
  assert.equal(parseCreateSocialLink({ label: "A", url: "https://example.test", profileId: 2 }).invalidShape, true);
  assert.equal(parseCreateSocialLink({ label: "A", url: "https://example.test", sortOrder: 0 }).invalidShape, true);
  assert.equal(parseSocialLinkPatch({}).invalidShape, true);
  assert.equal(parseSocialLinkPatch({ id: LINK_ID, label: "A" }).invalidShape, true);
  assert.ok(parseSocialLinkPatch({ label: "" }).errors.label);
  assert.ok(parseSocialLinkPatch({ url: "http://example.test" }).errors.url);
  assert.deepEqual(parseSocialLinkPatch({ label: "  A  " }), {
    data: { label: "A" },
    errors: {},
  });
});

test("validates UUIDs, duplicate order IDs, list bounds, and server-assigned sort orders", () => {
  assert.deepEqual(parseSocialLinkReorder({ orderedIds: [SECOND_LINK_ID, LINK_ID] }), [
    SECOND_LINK_ID,
    LINK_ID,
  ]);
  assert.equal(parseSocialLinkReorder({ orderedIds: [LINK_ID, LINK_ID] }), null);
  assert.equal(parseSocialLinkReorder({ orderedIds: ["invalid"] }), null);
  assert.equal(parseSocialLinkReorder({ orderedIds: Array(SOCIAL_LINK_MAX_COUNT + 1).fill(LINK_ID) }), null);
  assert.equal(parseSocialLinkReorder({ orderedIds: [], extra: true }), null);
  assert.equal(resolveNextSocialLinkSortOrder(null), 0);
  assert.equal(resolveNextSocialLinkSortOrder(7), 8);
  assert.equal(resolveNextSocialLinkSortOrder(SOCIAL_LINK_SORT_ORDER_MAX), null);
  assert.equal(resolveNextSocialLinkSortOrder(-2), 0);
  assert.equal(resolveNextSocialLinkSortOrder(1.5), null);
});

test("lists links only after authorization and returns safe no-store errors", async () => {
  const denied = Response.json(
    { error: "Authentication is required." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
  const deniedDeps = dependencies({ authorize: async () => denied });
  const deniedResponse = await handleSocialLinkList(
    request("/api/admin/profile/social-links", "GET"),
    deniedDeps.values,
  );
  assert.equal(deniedResponse.status, 401);
  assert.equal(deniedDeps.calls.findAll, 0);
  assert.equal(deniedResponse.headers.get("cache-control"), "no-store");

  const successDeps = dependencies();
  const success = await handleSocialLinkList(
    request("/api/admin/profile/social-links", "GET"),
    successDeps.values,
  );
  assert.equal(success.status, 200);
  assert.deepEqual((await success.json()).links, [link()]);
  assert.equal(success.headers.get("cache-control"), "no-store");

  const failed = await handleSocialLinkList(
    request("/api/admin/profile/social-links", "GET"),
    dependencies({ findAll: async () => { throw new Error("private database detail"); } }).values,
  );
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Unable to load social links." });
  assert.equal(failed.headers.get("cache-control"), "no-store");
});

test("creates normalized links and rejects unauthorized, malformed, or untrusted writes", async () => {
  const stored: SocialLinkInput[] = [];
  const allowed = dependencies({
    create: async (data: SocialLinkInput) => {
      stored.push(data);
      return link(data);
    },
  });
  const created = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", {
      label: " Code profile ",
      url: "HTTPS://Example.Test/me",
    }),
    allowed.values,
  );
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.deepEqual(stored, [{ label: "Code profile", url: "https://example.test/me" }]);

  const denied = dependencies({
    authorize: async () => Response.json({ error: "Invalid request." }, { status: 403 }),
  });
  const deniedResponse = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", { label: "X", url: "https://x.test" }),
    denied.values,
  );
  assert.equal(deniedResponse.status, 403);
  assert.equal(denied.calls.create, 0);

  const unexpected = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", {
      label: "X", url: "https://x.test", profileId: 7,
    }),
    dependencies().values,
  );
  assert.equal(unexpected.status, 400);

  const untrusted = dependencies({
    authorize: async (incoming: Request) => hasTrustedRequestOrigin(incoming)
      ? null
      : Response.json({ error: "Invalid request." }, { status: 403 }),
  });
  const untrustedResponse = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", {
      label: "X", url: "https://x.test",
    }, { origin: "https://attacker.example" }),
    untrusted.values,
  );
  assert.equal(untrustedResponse.status, 403);
  assert.equal(untrusted.calls.create, 0);

  const contentType = dependencies({
    authorize: async (incoming: Request) =>
      incoming.headers.get("content-type") === "application/json"
        ? null
        : Response.json({ error: "Content-Type must be application/json." }, {
            status: 415,
            headers: { "Cache-Control": "no-store" },
          }),
  });
  const wrongContentType = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", { label: "X", url: "https://x.test" }, {
      contentType: "text/plain",
    }),
    contentType.values,
  );
  assert.equal(wrongContentType.status, 415);
  assert.equal(contentType.calls.create, 0);
});

test("maps concurrent ordering conflicts to safe retry responses", async () => {
  const createConflict = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", {
      label: "Portfolio", url: "https://example.test/profile",
    }),
    dependencies({
      create: async () => { throw new SocialLinkWriteConflictError(); },
    }).values,
  );
  assert.equal(createConflict.status, 409);
  assert.equal(createConflict.headers.get("cache-control"), "no-store");

  const deleteConflict = await handleSocialLinkDelete(
    request(`/api/admin/profile/social-links/${LINK_ID}`, "DELETE"),
    LINK_ID,
    dependencies({
      delete: async () => { throw new SocialLinkWriteConflictError(); },
    }).values,
  );
  assert.equal(deleteConflict.status, 409);
  assert.equal(deleteConflict.headers.get("cache-control"), "no-store");
});

test("trusted Origin validation accepts only the local development origin in development", () => {
  const environment = process.env as Record<string, string | undefined>;
  const originalNodeEnv = environment.NODE_ENV;
  const originalVercel = environment.VERCEL;
  environment.NODE_ENV = "development";
  delete environment.VERCEL;

  try {
    assert.equal(hasTrustedRequestOrigin(new Request("http://localhost:3000", {
      headers: { Origin: "http://localhost:3000" },
    })), true);
    assert.equal(hasTrustedRequestOrigin(new Request("http://localhost:3000", {
      headers: { Origin: "https://attacker.example" },
    })), false);
  } finally {
    if (originalNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = originalNodeEnv;
    if (originalVercel === undefined) delete environment.VERCEL;
    else environment.VERCEL = originalVercel;
  }
});

test("rejects JSON parse failures and bounded request overflows", async () => {
  const malformed = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", undefined, { rawBody: "{" }),
    dependencies().values,
  );
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "no-store");

  const oversizedBody = JSON.stringify({ label: "L", url: "https://example.test", extra: "x".repeat(17_000) });
  const oversized = await handleSocialLinkCreate(
    request("/api/admin/profile/social-links", "POST", undefined, { rawBody: oversizedBody }),
    dependencies().values,
  );
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("cache-control"), "no-store");
});

test("updates only supplied allowed fields and safely handles invalid or missing IDs", async () => {
  let receivedPatch: Partial<SocialLinkInput> | undefined;
  let updateCalls = 0;
  const deps = dependencies({
    update: async (id: string, patch: Partial<SocialLinkInput>) => {
      updateCalls += 1;
      receivedPatch = patch;
      return id === LINK_ID
        ? { kind: "updated" as const, link: link(patch) }
        : { kind: "missing" as const };
    },
  });
  const updated = await handleSocialLinkUpdate(
    request(`/api/admin/profile/social-links/${LINK_ID}`, "PATCH", { label: "New label" }),
    LINK_ID,
    deps.values,
  );
  assert.equal(updated.status, 200);
  assert.deepEqual(receivedPatch, { label: "New label" });
  assert.equal(updated.headers.get("cache-control"), "no-store");

  const invalid = await handleSocialLinkUpdate(
    request("/api/admin/profile/social-links/not-a-uuid", "PATCH", { label: "New" }),
    "not-a-uuid",
    deps.values,
  );
  assert.equal(invalid.status, 404);
  assert.equal(updateCalls, 1);

  const missing = await handleSocialLinkUpdate(
    request(`/api/admin/profile/social-links/${SECOND_LINK_ID}`, "PATCH", { url: "https://x.test" }),
    SECOND_LINK_ID,
    deps.values,
  );
  assert.equal(missing.status, 404);
});

test("deletes only after authorization and accepts a bodyless request", async () => {
  let observedContentType: string | null = "set";
  const deps = dependencies({
    authorize: async (incoming: Request) => {
      observedContentType = incoming.headers.get("content-type");
      return null;
    },
  });
  const deleted = await handleSocialLinkDelete(
    request(`/api/admin/profile/social-links/${LINK_ID}`, "DELETE", undefined, { contentType: null }),
    LINK_ID,
    deps.values,
  );
  assert.equal(deleted.status, 200);
  assert.equal(observedContentType, null);
  assert.equal(deps.calls.delete, 1);
  assert.equal(deleted.headers.get("cache-control"), "no-store");
});

test("validates reorder requests and maps stale links or database failures safely", async () => {
  const stale = await handleSocialLinkReorder(
    request("/api/admin/profile/social-links", "PATCH", { orderedIds: [LINK_ID] }),
    dependencies({ reorder: async () => false }).values,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("cache-control"), "no-store");

  const invalid = await handleSocialLinkReorder(
    request("/api/admin/profile/social-links", "PATCH", { orderedIds: ["bad"] }),
    dependencies().values,
  );
  assert.equal(invalid.status, 400);

  const failed = await handleSocialLinkReorder(
    request("/api/admin/profile/social-links", "PATCH", { orderedIds: [LINK_ID] }),
    dependencies({ reorder: async () => { throw new Error("private transaction detail"); } }).values,
  );
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: "Unable to reorder social links." });
  assert.equal(failed.headers.get("cache-control"), "no-store");
});

test("reorders the complete owned set and refuses stale lists before writing", async () => {
  const order = new Map([[LINK_ID, 4], [SECOND_LINK_ID, 9]]);
  const writes: Array<[number, string, number]> = [];
  const transaction = {
    findLinkIds: async (profileId: number) => {
      assert.equal(profileId, 1);
      return [...order.keys()];
    },
    setLinkSortOrder: async (profileId: number, id: string, sortOrder: number) => {
      writes.push([profileId, id, sortOrder]);
      order.set(id, sortOrder);
      return 1;
    },
  };

  assert.equal(
    await reorderProfileSocialLinksInTransaction(transaction, [SECOND_LINK_ID, LINK_ID]),
    true,
  );
  assert.deepEqual([...order.entries()], [[LINK_ID, 1], [SECOND_LINK_ID, 0]]);
  assert.deepEqual(writes, [[1, SECOND_LINK_ID, 0], [1, LINK_ID, 1]]);

  writes.length = 0;
  assert.equal(await reorderProfileSocialLinksInTransaction(transaction, [LINK_ID]), false);
  assert.deepEqual(writes, []);
});

test("profile dirty-state comparison ignores normalized whitespace and URL-equivalent values", () => {
  const initial = {
    displayName: "Ada Lovelace",
    headline: "",
    shortBio: "",
    biography: "First line\nSecond line",
    avatarUrl: "https://example.test/image",
  };
  const equivalent = {
    displayName: "  Ada   Lovelace  ",
    headline: "",
    shortBio: "  ",
    biography: "First line\r\nSecond line",
    avatarUrl: "HTTPS://EXAMPLE.TEST:443/image",
  };
  assert.equal(hasProfileUnsavedChanges(initial, equivalent), false);
  assert.equal(hasProfileUnsavedChanges(initial, { ...equivalent, biography: "Changed" }), true);
});

test("public profile query selects only public details and ordered social labels and URLs", () => {
  assert.deepEqual(publicSiteProfileQuery.where, { id: 1 });
  assert.deepEqual(publicSiteProfileQuery.select.socialLinks, {
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { label: true, url: true },
  });
  assert.equal("profileId" in publicSiteProfileQuery.select.socialLinks.select, false);
  assert.equal("id" in publicSiteProfileQuery.select.socialLinks.select, false);
  assert.equal("createdAt" in publicSiteProfileQuery.select, false);
});

test("public profile output filters unsafe stored social URLs and normalizes valid links", () => {
  assert.deepEqual(filterSafePublicSocialLinks([
    { label: " Valid ", url: " HTTPS://Example.Test/profile " },
    { label: "Invalid protocol", url: "javascript:alert(1)" },
    { label: "Credentials", url: "https://user:pass@example.test/profile" },
    { label: " ", url: "https://example.test/profile" },
  ]), [
    { label: "Valid", url: "https://example.test/profile" },
  ]);
});

test("public social links are escaped, secure new-tab links, and absent when empty", () => {
  const renderer = [
    "import { createElement } from 'react';",
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import { ProfileSocialLinks } from './src/app/about/profile-social-links.tsx';",
    "const empty = renderToStaticMarkup(createElement(ProfileSocialLinks, { links: [] }));",
    "const markup = renderToStaticMarkup(createElement(ProfileSocialLinks, { links: [{ label: 'Code <Profile>', url: 'https://example.test/profile?x=1&y=2' }] }));",
    "console.log(JSON.stringify({ empty, markup }));",
  ].join("\n");
  const rendered = JSON.parse(execFileSync(
    process.execPath,
    ["--input-type=module", "--import=tsx", "--eval", renderer],
    { cwd: process.cwd(), encoding: "utf8" },
  )) as { empty: string; markup: string };
  assert.equal(rendered.empty, "");
  const { markup } = rendered;
  assert.match(markup, /aria-label="Social profiles"/u);
  assert.match(markup, /target="_blank"/u);
  assert.match(markup, /rel="noopener noreferrer"/u);
  assert.match(markup, /referrerPolicy="no-referrer"/u);
  assert.match(markup, /Code &lt;Profile&gt;/u);
  assert.match(markup, /x=1&amp;y=2/u);
  assert.match(markup, /opens in a new tab/u);
});
