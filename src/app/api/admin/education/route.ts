import "server-only";

import {
  authorizeAdminContentRead,
  authorizeAdminContentWrite,
} from "@/lib/auth/admin-content";
import {
  educationOrderBy,
  educationSelect,
} from "@/lib/education-content";
import {
  handleEducationCreate,
  handleEducationList,
} from "@/lib/education-management";
import type {
  EducationMutationData,
  EducationRecord,
} from "@/lib/education-validation";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request): Promise<Response> {
  return handleEducationList(request, {
    authorize: authorizeAdminContentRead,
    findAll: () =>
      prisma.education.findMany({
        orderBy: educationOrderBy,
        select: educationSelect,
      }) as Promise<EducationRecord[]>,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleEducationCreate(request, {
    authorize: authorizeAdminContentWrite,
    create: (data) =>
      prisma.education.create({
        data: data satisfies EducationMutationData,
        select: educationSelect,
      }) as Promise<EducationRecord>,
  });
}
