import type { AdminRole } from "@/generated/prisma/client";

export interface EducationAdminSession {
  user: { role: AdminRole };
}

export function isAuthorizedEducationSession<Session extends EducationAdminSession>(
  session: Session | null | undefined,
): session is Session {
  return session !== null && session !== undefined &&
    (session.user.role === "ADMIN" || session.user.role === "EDITOR");
}
