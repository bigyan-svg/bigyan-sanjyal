import "server-only";

import { authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { deleteEducationWithVersion, updateEducationInTransaction } from "@/lib/education-content";
import {
  handleEducationDelete,
  handleEducationUpdate,
} from "@/lib/education-management";
import { prisma } from "@/lib/prisma";

interface EducationRouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: EducationRouteContext,
): Promise<Response> {
  const { id } = await context.params;

  return handleEducationUpdate(request, id, {
    authorize: authorizeAdminContentWrite,
    update: (educationId, patch, expectedVersion, now) =>
      prisma.$transaction((transaction) =>
        updateEducationInTransaction(transaction, educationId, patch, expectedVersion, now),
      ),
  });
}

export async function DELETE(
  request: Request,
  context: EducationRouteContext,
): Promise<Response> {
  const { id } = await context.params;

  return handleEducationDelete(request, id, {
    authorize: (incomingRequest) => authorizeAdminContentWrite(incomingRequest, false),
    delete: (educationId, expectedVersion) =>
      prisma.$transaction((transaction) =>
        deleteEducationWithVersion(transaction, educationId, expectedVersion),
      ),
  });
}
