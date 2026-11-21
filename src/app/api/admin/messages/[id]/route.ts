import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminOnlyContentWrite } from "@/lib/auth/admin-content";
import {
  handleAdminMessagePatch,
  performAdminMessageAction,
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
    authorize: authorizeAdminOnlyContentWrite,
    performAction: (messageId, action, now) =>
      prisma.$transaction(async (transaction) => {
        return performAdminMessageAction({
          findState: (id) => transaction.contactMessage.findUnique({
            where: { id },
            select: { status: true, readAt: true },
          }),
          updateState: async (id, current, transition) => {
            const result = await transaction.contactMessage.updateMany({
              where: {
                id,
                status: current.status,
                readAt: current.readAt,
              },
              data: {
                status: transition.status,
                readAt: transition.readAt,
              },
            });
            return result.count === 1;
          },
          findDetail: (id) => transaction.contactMessage.findUnique({
            where: { id },
            select: adminMessageDetailSelect,
          }),
        }, messageId, action, now);
      }),
  });
}
