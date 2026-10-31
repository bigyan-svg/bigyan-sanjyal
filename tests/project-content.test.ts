import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import { ProjectSkillMissingError, syncProjectRelations } from "../src/lib/project-content";
import type { ProjectInputData } from "../src/lib/project-validation";

const skillId = "123e4567-e89b-42d3-a456-426614174000";
const projectId = "223e4567-e89b-42d3-a456-426614174000";

function createTransaction(availableSkillIds: string[] = [skillId]) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const transaction = {
    skill: {
      findMany: async (args: unknown) => {
        calls.push({ method: "skill.findMany", args });
        return availableSkillIds.map((id) => ({ id }));
      },
    },
    projectSkill: {
      deleteMany: async (args: unknown) => { calls.push({ method: "projectSkill.deleteMany", args }); },
      createMany: async (args: unknown) => { calls.push({ method: "projectSkill.createMany", args }); },
    },
    projectLink: {
      deleteMany: async (args: unknown) => { calls.push({ method: "projectLink.deleteMany", args }); },
      createMany: async (args: unknown) => { calls.push({ method: "projectLink.createMany", args }); },
    },
    projectImage: {
      deleteMany: async (args: unknown) => { calls.push({ method: "projectImage.deleteMany", args }); },
      createMany: async (args: unknown) => { calls.push({ method: "projectImage.createMany", args }); },
    },
  } as unknown as Prisma.TransactionClient;

  return { transaction, calls };
}

function baseInput(overrides: Partial<ProjectInputData> = {}): ProjectInputData {
  return {
    title: "Sample Project",
    slug: "sample-project",
    summary: "A confirmed project summary.",
    description: null,
    categoryId: null,
    featured: false,
    sortOrder: 0,
    status: "DRAFT",
    ...overrides,
  };
}

test("project relation writes preserve omitted relations on unrelated updates", async () => {
  const { transaction, calls } = createTransaction();

  await syncProjectRelations(transaction, projectId, baseInput());

  assert.deepEqual(calls, []);
});

test("project relation writes replace skills, links, and images in the caller transaction", async () => {
  const { transaction, calls } = createTransaction();

  await syncProjectRelations(transaction, projectId, baseInput({
    skillIds: [skillId],
    links: [{ type: "GITHUB_REPOSITORY", label: "Source", url: "https://github.com/example/repo", sortOrder: 0 }],
    images: [{ imageUrl: "https://cdn.example.test/image.png", altText: "Project interface", caption: null, sortOrder: 0 }],
  }));

  assert.deepEqual(calls.map(({ method }) => method), [
    "skill.findMany",
    "projectSkill.deleteMany",
    "projectSkill.createMany",
    "projectLink.deleteMany",
    "projectLink.createMany",
    "projectImage.deleteMany",
    "projectImage.createMany",
  ]);
  assert.deepEqual(calls[2]?.args, { data: [{ projectId, skillId }] });
  assert.deepEqual(calls[4]?.args, {
    data: [{ projectId, type: "GITHUB_REPOSITORY", label: "Source", url: "https://github.com/example/repo", sortOrder: 0 }],
  });
  assert.deepEqual(calls[6]?.args, {
    data: [{ projectId, imageUrl: "https://cdn.example.test/image.png", altText: "Project interface", caption: null, sortOrder: 0 }],
  });
});

test("missing selected skills fail before any existing relations are replaced", async () => {
  const { transaction, calls } = createTransaction([]);

  await assert.rejects(
    syncProjectRelations(transaction, projectId, baseInput({
      skillIds: [skillId],
      links: [],
      images: [],
    })),
    ProjectSkillMissingError,
  );
  assert.deepEqual(calls.map(({ method }) => method), ["skill.findMany"]);
});

test("empty relation arrays explicitly clear only the submitted relation collections", async () => {
  const { transaction, calls } = createTransaction();

  await syncProjectRelations(transaction, projectId, baseInput({ links: [], images: [] }));

  assert.deepEqual(calls.map(({ method }) => method), ["projectLink.deleteMany", "projectImage.deleteMany"]);
});
