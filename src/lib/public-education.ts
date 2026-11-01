import "server-only";

import { prisma } from "@/lib/prisma";
import { readPublishedEducation } from "@/lib/public-education-query";

export type { PublicEducation, PublishedEducationResult } from "@/lib/public-education-query";

export function getPublishedEducation() {
  return readPublishedEducation((query) => prisma.education.findMany(query));
}
