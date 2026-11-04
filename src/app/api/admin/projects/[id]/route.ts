import "server-only";

import { authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { deleteProjectWithVersion, updateProjectInTransaction } from "@/lib/project-content";
import { handleProjectDelete, handleProjectUpdate } from "@/lib/project-management";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleProjectUpdate(request, id, {
    authorize: authorizeAdminContentWrite,
    update: (projectId, input, expectedVersion, now) =>
      prisma.$transaction((transaction) =>
        updateProjectInTransaction(transaction, projectId, input, expectedVersion, now),
      ),
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleProjectDelete(request, id, {
    authorize: (incomingRequest) => authorizeAdminContentWrite(incomingRequest, false),
    delete: (projectId, expectedVersion) =>
      prisma.$transaction((transaction) => deleteProjectWithVersion(transaction, projectId, expectedVersion)),
  });
}
