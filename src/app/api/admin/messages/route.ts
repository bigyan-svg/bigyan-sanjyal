import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { authorizeAdminContentRead } from "@/lib/auth/admin-content";
import {
  handleAdminMessagesList,
  type AdminMessageListItem,
} from "@/lib/admin-messages";
import { prisma } from "@/lib/prisma";

const adminMessageListSelect = {
  id: true,
  name: true,
  email: true,
  subject: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ContactMessageSelect;

export async function GET(request: Request): Promise<Response> {
  return handleAdminMessagesList(request, {
    authorize: (incomingRequest) => authorizeAdminContentRead(incomingRequest),
    findMessages: async ({ status, skip, take }) =>
      prisma.contactMessage.findMany({
        where: status ? { status } : undefined,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: adminMessageListSelect,
      }) as Promise<AdminMessageListItem[]>,
    countMessages: (status) =>
      prisma.contactMessage.count({ where: status ? { status } : undefined }),
    countNewMessages: () => prisma.contactMessage.count({ where: { status: "NEW" } }),
  });
}
