import "server-only";

import { prisma } from "@/lib/prisma";
import { readPublishedWorkExperiences } from "@/lib/public-experience-query";

export type { PublicWorkExperience, PublishedWorkExperienceResult } from "@/lib/public-experience-query";

export function getPublishedWorkExperiences() {
  return readPublishedWorkExperiences((query) => prisma.workExperience.findMany(query));
}
