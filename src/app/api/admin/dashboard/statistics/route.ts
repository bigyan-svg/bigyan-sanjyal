import "server-only";

import {
  authorizeAdminContentRead,
  authorizeAdminOnlyContentRead,
} from "@/lib/auth/admin-content";
import { getPrismaAdminDashboardCountQueries } from "@/lib/admin-dashboard-statistics";
import { handleAdminDashboardStatisticsRequest } from "@/lib/admin-dashboard-statistics-core";

export async function GET(request: Request): Promise<Response> {
  return handleAdminDashboardStatisticsRequest(request, {
    authorize: authorizeAdminContentRead,
    authorizeAdminOnly: authorizeAdminOnlyContentRead,
    queries: getPrismaAdminDashboardCountQueries(),
  });
}
