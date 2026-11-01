import "server-only";

import {
  authorizeAdminContentRead,
  authorizeAdminContentWrite,
} from "@/lib/auth/admin-content";
import { workExperienceSelect } from "@/lib/work-experience-content";
import {
  handleWorkExperienceCreate,
  handleWorkExperienceList,
} from "@/lib/work-experience-management";
import type { WorkExperienceRecord } from "@/lib/work-experience-validation";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request): Promise<Response> {
  return handleWorkExperienceList(request, {
    authorize: authorizeAdminContentRead,
    findAll: () =>
      prisma.workExperience.findMany({
        orderBy: [{ sortOrder: "asc" }, { startDate: "desc" }, { id: "asc" }],
        select: workExperienceSelect,
      }) as Promise<WorkExperienceRecord[]>,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleWorkExperienceCreate(request, {
    authorize: authorizeAdminContentWrite,
    create: (data) =>
      prisma.workExperience.create({
        data,
        select: workExperienceSelect,
      }) as Promise<WorkExperienceRecord>,
  });
}
