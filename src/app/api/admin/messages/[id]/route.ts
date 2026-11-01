import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentWrite } from "@/lib/auth/admin-content";
import {
  handleAdminMessagePatch,
  resolveContactMessageTransition,
  type AdminMessageDetail,
} from "@/lib/admin-messages";
import { prisma } from "@/lib/prisma";

const adminMessageDetailSelect = {
  id: true,
  name: true,
  email: true,
  subject: true,
  message: true,
  status: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ContactMessageSelect;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  return handleAdminMessagePatch(request, id, {
    authorize: authorizeAdminContentWrite,
    performAction: (messageId, action, now) =>
      prisma.$transaction(async (transaction) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = await transaction.contactMessage.findUnique({
            where: { id: messageId },
            select: { status: true, readAt: true },
          });
          if (!current) return null;

          const transition = resolveContactMessageTransition(current, action, now);
          if (!transition.changed) break;

          const updated = await transaction.contactMessage.updateMany({
            where: { id: messageId, status: current.status },
            data: {
              status: transition.status,
              readAt: transition.readAt,
            },
          });
          if (updated.count === 1) break;
        }

        return transaction.contactMessage.findUnique({
          where: { id: messageId },
          select: adminMessageDetailSelect,
        }) as Promise<AdminMessageDetail | null>;
      }),
  });
}
