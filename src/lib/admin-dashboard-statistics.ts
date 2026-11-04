import "server-only";

import { prisma } from "@/lib/prisma";
import { ADMIN_DASHBOARD_STATISTIC_KEYS } from "./admin-dashboard-statistics-types";
import {
  createAdminDashboardCountQueries,
  loadAdminDashboardStatistics as loadStatistics,
} from "./admin-dashboard-statistics-core";

const prismaCountQueries = createAdminDashboardCountQueries({
  projectCount: (status) => prisma.project.count(status ? { where: { status } } : undefined),
  postCount: (status) => prisma.post.count(status ? { where: { status } } : undefined),
  skillCount: (status) => prisma.skill.count(status ? { where: { status } } : undefined),
  educationCount: (status) => prisma.education.count(status ? { where: { status } } : undefined),
  experienceCount: (status) => prisma.workExperience.count(status ? { where: { status } } : undefined),
  messageCount: (status) => prisma.contactMessage.count(status ? { where: { status } } : undefined),
});

export function getPrismaAdminDashboardCountQueries() {
  return prismaCountQueries;
}

export async function loadAdminDashboardStatistics(
  keys: readonly (typeof ADMIN_DASHBOARD_STATISTIC_KEYS)[number][] =
    ADMIN_DASHBOARD_STATISTIC_KEYS,
) {
  return loadStatistics(keys, prismaCountQueries);
}
