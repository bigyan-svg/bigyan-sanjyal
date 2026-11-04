import {
  parseAdminDashboardStatistic,
  type AdminDashboardStatistic,
  type AdminDashboardStatisticKey,
} from "./admin-dashboard-statistics-types";

export type AdminDashboardStatisticFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export async function requestAdminDashboardStatistic(
  key: AdminDashboardStatisticKey,
  fetcher: AdminDashboardStatisticFetcher = fetch,
): Promise<AdminDashboardStatistic> {
  const query = new URLSearchParams({ metric: key });
  const response = await fetcher(
    `/api/admin/dashboard/statistics?${query.toString()}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );

  if (!response.ok) {
    throw new Error("Statistics refresh failed.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Statistics refresh failed.");
  }

  const statistic = parseAdminDashboardStatistic(payload, key);
  if (!statistic) {
    throw new Error("Statistics refresh failed.");
  }

  return statistic;
}
