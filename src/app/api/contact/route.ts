import "server-only";

import { hasTrustedRequestOrigin } from "@/lib/auth/origin";
import { checkContactSubmissionRateLimit } from "@/lib/auth/login-rate-limit";
import { handleContactSubmission } from "@/lib/contact-submission";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request): Promise<Response> {
  return handleContactSubmission(request, {
    isTrustedOrigin: hasTrustedRequestOrigin,
    checkRateLimit: checkContactSubmissionRateLimit,
    createMessage: async (data) => {
      await prisma.contactMessage.create({
        data,
        select: { id: true },
      });
    },
  });
}
