import type {
  AdminDashboardStatisticKey,
  AdminDashboardStatistics,
} from "./admin-dashboard-statistics-types";
import { ADMIN_DASHBOARD_STATISTIC_KEYS } from "./admin-dashboard-statistics-types";

export type AdminDashboardCountQueries = Record<
  AdminDashboardStatisticKey,
  () => Promise<number>
>;

export interface AdminDashboardCountStore {
  projectCount: (status?: "PUBLISHED") => Promise<number>;
  postCount: (status?: "PUBLISHED") => Promise<number>;
  skillCount: (status?: "PUBLISHED") => Promise<number>;
  educationCount: (status?: "PUBLISHED") => Promise<number>;
  experienceCount: (status?: "PUBLISHED") => Promise<number>;
  messageCount: (status?: "NEW") => Promise<number>;
}

export function createAdminDashboardCountQueries(
  store: AdminDashboardCountStore,
): AdminDashboardCountQueries {
  return {
    projectsTotal: () => store.projectCount(),
    projectsPublished: () => store.projectCount("PUBLISHED"),
    postsTotal: () => store.postCount(),
    postsPublished: () => store.postCount("PUBLISHED"),
    skillsTotal: () => store.skillCount(),
    skillsPublished: () => store.skillCount("PUBLISHED"),
    educationTotal: () => store.educationCount(),
    educationPublished: () => store.educationCount("PUBLISHED"),
    experienceTotal: () => store.experienceCount(),
    experiencePublished: () => store.experienceCount("PUBLISHED"),
    messagesTotal: () => store.messageCount(),
    messagesNew: () => store.messageCount("NEW"),
  };
}

export async function loadAdminDashboardStatistics(
  keys: readonly AdminDashboardStatisticKey[],
  queries: AdminDashboardCountQueries,
): Promise<AdminDashboardStatistics> {
  const uniqueKeys = [...new Set(keys)];
  const results = await Promise.all(
    uniqueKeys.map(async (key) => {
      try {
        const count = await queries[key]();
        return [key, { status: "available", count } as const] as const;
      } catch {
        return [key, { status: "unavailable" } as const] as const;
      }
    }),
  );

  return Object.fromEntries(results);
}

export function parseAdminDashboardMetricRequest(
  request: Request,
): AdminDashboardStatisticKey[] | null {
  const searchParams = new URL(request.url).searchParams;
  const entries = [...searchParams.entries()];
  if (
    entries.length === 0 ||
    entries.some(([key]) => key !== "metric") ||
    entries.length > ADMIN_DASHBOARD_STATISTIC_KEYS.length
  ) {
    return null;
  }

  const metrics = searchParams.getAll("metric");
  const allowedKeys = new Set<string>(ADMIN_DASHBOARD_STATISTIC_KEYS);
  if (
    metrics.length !== entries.length ||
    metrics.some((metric) => !allowedKeys.has(metric)) ||
    new Set(metrics).size !== metrics.length
  ) {
    return null;
  }

  return metrics as AdminDashboardStatisticKey[];
}

export interface AdminDashboardStatisticsHandlerDependencies {
  authorize: (request: Request) => Promise<Response | null>;
  authorizeAdminOnly: (request: Request) => Promise<Response | null>;
  queries: AdminDashboardCountQueries;
}

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function handleAdminDashboardStatisticsRequest(
  request: Request,
  dependencies: AdminDashboardStatisticsHandlerDependencies,
): Promise<Response> {
  const metrics = parseAdminDashboardMetricRequest(request);
  const requiresAdmin = metrics?.some(
    (key) => key === "messagesTotal" || key === "messagesNew",
  );

  try {
    const authorize = requiresAdmin
      ? dependencies.authorizeAdminOnly
      : dependencies.authorize;
    const authorizationError = await authorize(request);
    if (authorizationError) return authorizationError;
  } catch {
    return jsonResponse({ error: "Unable to authorize this request." }, 500);
  }

  if (!metrics) return jsonResponse({ error: "Invalid statistics request." }, 400);

  const statistics = await loadAdminDashboardStatistics(metrics, dependencies.queries);
  return jsonResponse({ statistics }, 200);
}
