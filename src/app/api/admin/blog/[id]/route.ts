import "server-only";

import { authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import { deleteBlogPostWithVersion, updateBlogPostInTransaction } from "@/lib/blog-content";
import { handleBlogPostDelete, handleBlogPostUpdate } from "@/lib/blog-management";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleBlogPostUpdate(request, id, {
    authorize: authorizeAdminContentWrite,
    update: (postId, input, expectedVersion, now) =>
      prisma.$transaction((transaction) =>
        updateBlogPostInTransaction(transaction, postId, input, expectedVersion, now),
      ),
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleBlogPostDelete(request, id, {
    authorize: (incomingRequest) => authorizeAdminContentWrite(incomingRequest, false),
    delete: (postId, expectedVersion) =>
      prisma.$transaction((transaction) => deleteBlogPostWithVersion(transaction, postId, expectedVersion)),
  });
}
