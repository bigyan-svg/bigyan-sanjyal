import "server-only";

import {
  authorizeAdminContentWrite,
} from "@/lib/auth/admin-content";
import { updateWorkExperienceInTransaction } from "@/lib/work-experience-content";
import {
  handleWorkExperienceDelete,
  handleWorkExperienceUpdate,
} from "@/lib/work-experience-management";
import { prisma } from "@/lib/prisma";

interface WorkExperienceRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: WorkExperienceRouteContext,
): Promise<Response> {
  const { id } = await context.params;

  return handleWorkExperienceUpdate(request, id, {
    authorize: authorizeAdminContentWrite,
    update: (experienceId, patch, now) =>
      prisma.$transaction((transaction) =>
        updateWorkExperienceInTransaction(transaction, experienceId, patch, now),
      ),
  });
}

export async function DELETE(
  request: Request,
  context: WorkExperienceRouteContext,
): Promise<Response> {
  const { id } = await context.params;

  return handleWorkExperienceDelete(request, id, {
    authorize: (incomingRequest) => authorizeAdminContentWrite(incomingRequest, false),
    delete: async (experienceId) => {
      const result = await prisma.workExperience.deleteMany({
        where: { id: experienceId },
      });
      return result.count > 0;
    },
  });
}
