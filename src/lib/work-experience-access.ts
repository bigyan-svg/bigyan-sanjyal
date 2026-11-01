import type { AdminRole } from "@/generated/prisma/client";

export interface WorkExperienceAdminSession {
  user: { role: AdminRole };
}

export function isAuthorizedWorkExperienceSession<Session extends WorkExperienceAdminSession>(
  session: Session | null | undefined,
): session is Session {
  return session !== null && session !== undefined &&
    (session.user.role === "ADMIN" || session.user.role === "EDITOR");
}
