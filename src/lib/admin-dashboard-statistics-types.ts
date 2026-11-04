export const ADMIN_DASHBOARD_STATISTIC_KEYS = [
  "projectsTotal",
  "projectsPublished",
  "postsTotal",
  "postsPublished",
  "skillsTotal",
  "skillsPublished",
  "educationTotal",
  "educationPublished",
  "experienceTotal",
  "experiencePublished",
  "messagesTotal",
  "messagesNew",
] as const;

export type AdminDashboardStatisticKey =
  (typeof ADMIN_DASHBOARD_STATISTIC_KEYS)[number];

export type AdminDashboardStatistic =
  | { status: "available"; count: number }
  | { status: "unavailable" };

export type AdminDashboardStatistics = Partial<
  Record<AdminDashboardStatisticKey, AdminDashboardStatistic>
>;

export function getUnavailableAdminDashboardStatisticKeys(
  statistics: AdminDashboardStatistics,
): AdminDashboardStatisticKey[] {
  return ADMIN_DASHBOARD_STATISTIC_KEYS.filter(
    (key) => statistics[key]?.status !== "available",
  );
}

export function mergeAdminDashboardStatistics(
  current: AdminDashboardStatistics,
  updates: AdminDashboardStatistics,
): AdminDashboardStatistics {
  return { ...current, ...updates };
}

export function parseAdminDashboardStatistic(
  payload: unknown,
  key: AdminDashboardStatisticKey,
): AdminDashboardStatistic | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const statistics = (payload as { statistics?: unknown }).statistics;
  if (typeof statistics !== "object" || statistics === null || Array.isArray(statistics)) {
    return null;
  }

  const statistic = (statistics as Record<string, unknown>)[key];
  if (typeof statistic !== "object" || statistic === null || Array.isArray(statistic)) {
    return null;
  }

  const value = statistic as Record<string, unknown>;
  if (value.status === "unavailable") return { status: "unavailable" };
  if (
    value.status === "available" &&
    typeof value.count === "number" &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0
  ) {
    return { status: "available", count: value.count };
  }

  return null;
}
