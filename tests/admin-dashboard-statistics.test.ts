import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { requestAdminDashboardStatistic } from "../src/lib/admin-dashboard-statistics-client";
import {
  createAdminDashboardCountQueries,
  handleAdminDashboardStatisticsRequest,
  loadAdminDashboardStatistics,
  parseAdminDashboardMetricRequest,
  type AdminDashboardCountQueries,
} from "../src/lib/admin-dashboard-statistics-core";
import {
  ADMIN_DASHBOARD_STATISTIC_KEYS,
  getAdminDashboardStatisticKeysForRole,
  getUnavailableAdminDashboardStatisticKeys,
  mergeAdminDashboardStatistics,
  parseAdminDashboardStatistic,
  type AdminDashboardStatistics,
} from "../src/lib/admin-dashboard-statistics-types";

function makeQueries(
  overrides: Partial<AdminDashboardCountQueries> = {},
): AdminDashboardCountQueries {
  return Object.fromEntries(
    ADMIN_DASHBOARD_STATISTIC_KEYS.map((key) => [
      key,
      overrides[key] ?? (async () => 4),
    ]),
  ) as AdminDashboardCountQueries;
}

function allAvailableStatistics(): AdminDashboardStatistics {
  return Object.fromEntries(
    ADMIN_DASHBOARD_STATISTIC_KEYS.map((key) => [
      key,
      { status: "available", count: 1 },
    ]),
  );
}

test("total and published metrics use distinct content counts, and messages report total and NEW", async () => {
  const seen: string[] = [];
  const queries = createAdminDashboardCountQueries({
    projectCount: async (status) => { seen.push(`projects:${status ?? "ALL"}`); return status ? 2 : 7; },
    postCount: async (status) => { seen.push(`posts:${status ?? "ALL"}`); return status ? 3 : 8; },
    skillCount: async (status) => { seen.push(`skills:${status ?? "ALL"}`); return status ? 4 : 9; },
    educationCount: async (status) => { seen.push(`education:${status ?? "ALL"}`); return status ? 1 : 5; },
    experienceCount: async (status) => { seen.push(`experience:${status ?? "ALL"}`); return status ? 2 : 6; },
    messageCount: async (status) => { seen.push(`messages:${status ?? "ALL"}`); return status ? 1 : 12; },
  });

  assert.equal(await queries.projectsTotal(), 7);
  assert.equal(await queries.projectsPublished(), 2);
  assert.equal(await queries.postsTotal(), 8);
  assert.equal(await queries.postsPublished(), 3);
  assert.equal(await queries.skillsTotal(), 9);
  assert.equal(await queries.skillsPublished(), 4);
  assert.equal(await queries.educationTotal(), 5);
  assert.equal(await queries.educationPublished(), 1);
  assert.equal(await queries.experienceTotal(), 6);
  assert.equal(await queries.experiencePublished(), 2);
  assert.equal(await queries.messagesTotal(), 12);
  assert.equal(await queries.messagesNew(), 1);
  assert.ok(seen.includes("projects:ALL"));
  assert.ok(seen.includes("projects:PUBLISHED"));
  assert.ok(seen.includes("messages:ALL"));
  assert.ok(seen.includes("messages:NEW"));
});

test("independent query failures do not hide successful dashboard statistics", async () => {
  const statistics = await loadAdminDashboardStatistics(
    ["projectsTotal", "projectsPublished", "messagesTotal", "messagesNew"],
    makeQueries({
      projectsPublished: async () => { throw new Error("internal database error"); },
      messagesTotal: async () => 0,
      messagesNew: async () => 0,
    }),
  );

  assert.deepEqual(statistics, {
    projectsTotal: { status: "available", count: 4 },
    projectsPublished: { status: "unavailable" },
    messagesTotal: { status: "available", count: 0 },
    messagesNew: { status: "available", count: 0 },
  });
  assert.doesNotMatch(JSON.stringify(statistics), /internal database error/u);
});

test("retry requests accept only unique allowlisted metric parameters", () => {
  const valid = new Request(
    "https://example.test/api/admin/dashboard/statistics?metric=projectsPublished&metric=messagesNew",
  );
  assert.deepEqual(parseAdminDashboardMetricRequest(valid), [
    "projectsPublished",
    "messagesNew",
  ]);

  for (const url of [
    "https://example.test/api/admin/dashboard/statistics",
    "https://example.test/api/admin/dashboard/statistics?metric=unknown",
    "https://example.test/api/admin/dashboard/statistics?metric=messagesNew&metric=messagesNew",
    "https://example.test/api/admin/dashboard/statistics?metric=messagesNew&extra=1",
  ]) {
    assert.equal(parseAdminDashboardMetricRequest(new Request(url)), null);
  }
});

test("authorization runs before retry queries and errors are no-store", async () => {
  let queryCount = 0;
  const denied = Response.json(
    { error: "Authentication is required." },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
  const response = await handleAdminDashboardStatisticsRequest(
    new Request("https://example.test/api/admin/dashboard/statistics?metric=projectsTotal"),
    {
      authorize: async () => denied,
      authorizeAdminOnly: async () => denied,
      queries: makeQueries({ projectsTotal: async () => { queryCount += 1; return 1; } }),
    },
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(queryCount, 0);
});

test("authorized statistics retry returns only the requested result with no-store", async () => {
  const response = await handleAdminDashboardStatisticsRequest(
    new Request("https://example.test/api/admin/dashboard/statistics?metric=messagesNew"),
    {
      authorize: async () => null,
      authorizeAdminOnly: async () => null,
      queries: makeQueries({ messagesNew: async () => 3 }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    statistics: { messagesNew: { status: "available", count: 3 } },
  });
});

test("message statistics require ADMIN authorization, including mixed metric requests", async () => {
  let messageQueryCount = 0;
  const forbidden = Response.json(
    { error: "You are not authorized." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
  const authorizeAdminOnly = async () => forbidden;
  const queries = makeQueries({
    messagesNew: async () => { messageQueryCount += 1; return 3; },
    messagesTotal: async () => { messageQueryCount += 1; return 5; },
  });

  for (const url of [
    "https://example.test/api/admin/dashboard/statistics?metric=messagesNew",
    "https://example.test/api/admin/dashboard/statistics?metric=projectsTotal&metric=messagesNew",
  ]) {
    const response = await handleAdminDashboardStatisticsRequest(
      new Request(url),
      {
        authorize: async () => null,
        authorizeAdminOnly,
        queries,
      },
    );
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }

  const editorContentResponse = await handleAdminDashboardStatisticsRequest(
    new Request("https://example.test/api/admin/dashboard/statistics?metric=projectsTotal"),
    {
      authorize: async () => null,
      authorizeAdminOnly,
      queries,
    },
  );
  assert.equal(editorContentResponse.status, 200);
  assert.equal(messageQueryCount, 0);
});

test("Editor dashboard statistics omit message counts", () => {
  const editorKeys = getAdminDashboardStatisticKeysForRole(false);
  const adminKeys = getAdminDashboardStatisticKeysForRole(true);

  assert.ok(!editorKeys.includes("messagesTotal"));
  assert.ok(!editorKeys.includes("messagesNew"));
  assert.ok(adminKeys.includes("messagesTotal"));
  assert.ok(adminKeys.includes("messagesNew"));
});

test("retry targets only unavailable counts and merges without replacing successful values", () => {
  const initial = allAvailableStatistics();
  initial.projectsPublished = { status: "unavailable" };

  assert.deepEqual(getUnavailableAdminDashboardStatisticKeys(initial), ["projectsPublished"]);
  const refreshed = parseAdminDashboardStatistic(
    { statistics: { projectsPublished: { status: "available", count: 2 } } },
    "projectsPublished",
  );
  assert.deepEqual(refreshed, { status: "available", count: 2 });
  assert.equal(parseAdminDashboardStatistic(
    { statistics: { projectsPublished: { status: "available", count: -1 } } },
    "projectsPublished",
  ), null);

  const merged = mergeAdminDashboardStatistics(initial, {
    projectsPublished: refreshed ?? { status: "unavailable" },
  });
  assert.deepEqual(merged.projectsPublished, { status: "available", count: 2 });
  assert.deepEqual(merged.projectsTotal, initial.projectsTotal);
});

test("retry requests only the requested metric without caching", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const statistic = await requestAdminDashboardStatistic(
    "projectsPublished",
    async (input, init) => {
      requestedUrl = input;
      requestedInit = init;
      return Response.json({
        statistics: { projectsPublished: { status: "available", count: 2 } },
      });
    },
  );

  assert.equal(statistic.status, "available");
  assert.equal(statistic.count, 2);
  assert.equal(
    requestedUrl,
    "/api/admin/dashboard/statistics?metric=projectsPublished",
  );
  assert.equal(requestedInit?.cache, "no-store");
  assert.deepEqual(requestedInit?.headers, { Accept: "application/json" });
});

test("retry failures stay generic and do not reveal server response details", async () => {
  await assert.rejects(
    requestAdminDashboardStatistic("messagesNew", async () =>
      Response.json({ error: "private database diagnostic" }, { status: 500 }),
    ),
    { message: "Statistics refresh failed." },
  );

  await assert.rejects(
    requestAdminDashboardStatistic("messagesNew", async () =>
      new Response("private database diagnostic", { status: 200 }),
    ),
    { message: "Statistics refresh failed." },
  );
});

test("dashboard getting-started links cover implemented sections without Soon placeholders", async () => {
  const page = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
  for (const href of [
    "/admin/profile",
    "/admin/projects",
    "/admin/skills",
    "/admin/blog",
    "/admin/education",
    "/admin/experience",
    "/admin/messages",
    "/admin/settings",
  ]) {
    assert.ok(page.includes(`href: "${href}"`), `missing dashboard link: ${href}`);
  }
  assert.doesNotMatch(page, /\bSoon\b/u);
});

test("dashboard Messages quick link and statistics are ADMIN-only", async () => {
  const page = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");

  assert.match(
    page,
    /\{ label: "Messages", description: "Review contact form submissions\.", href: "\/admin\/messages", icon: Mail, adminOnly: true \}/u,
  );
  assert.match(
    page,
    /dashboardQuickLinks\s*\.filter\(\(item\) => !item\.adminOnly \|\| session\.user\.role === "ADMIN"\)\s*\.map/u,
  );

  for (const href of [
    "/admin/profile",
    "/admin/projects",
    "/admin/skills",
    "/admin/blog",
    "/admin/education",
    "/admin/experience",
    "/admin/settings",
  ]) {
    assert.ok(page.includes(`href: "${href}"`), `missing Editor dashboard link: ${href}`);
  }

  assert.match(
    page,
    /<DashboardSummary isAdmin=\{session\.user\.role === "ADMIN"\} \/>/u,
  );
  assert.match(
    page,
    /getAdminDashboardStatisticKeysForRole\(isAdmin\)/u,
  );
});
