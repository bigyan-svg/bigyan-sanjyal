import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import dotenv from "dotenv";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  BlogCategoryMissingError,
  BlogTagsMissingError,
  deleteBlogPostWithVersion,
  updateBlogPostInTransaction,
} from "../src/lib/blog-content";
import {
  deleteBlogCategoryWithPosts,
  deleteBlogTagWithAssociations,
} from "../src/lib/blog-taxonomy-content";
import {
  deleteEducationWithVersion,
  updateEducationInTransaction,
} from "../src/lib/education-content";
import { handleEducationDelete } from "../src/lib/education-management";
import { deleteProjectWithVersion, updateProjectInTransaction } from "../src/lib/project-content";
import { handleProjectDelete } from "../src/lib/project-management";
import {
  deleteWorkExperienceWithVersion,
  updateWorkExperienceInTransaction,
} from "../src/lib/work-experience-content";
import { handleWorkExperienceDelete } from "../src/lib/work-experience-management";
import type { BlogPostInputData } from "../src/lib/blog-validation";
import type { EducationPatchData } from "../src/lib/education-validation";
import type { ProjectInputData } from "../src/lib/project-validation";
import type { WorkExperiencePatchData } from "../src/lib/work-experience-validation";
import { createIsolatedIntegrationPrismaClient } from "./helpers/isolated-test-prisma";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.integration.local", override: false, quiet: true });

const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };
const RACE_TIMEOUT_MS = 20_000;

let clientA: PrismaClient;
let clientB: PrismaClient;
let inspector: PrismaClient;

class TwoPartyBarrier {
  private arrivals = 0;
  private readonly gate: Promise<void>;
  private releaseGate!: () => void;

  constructor(private readonly label: string) {
    this.gate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
  }

  async wait(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals > 2) {
      throw new Error(`${this.label}: more than two operations reached the barrier.`);
    }
    if (this.arrivals === 2) this.releaseGate();
    await within(this.gate, `${this.label}: both operations did not reach the mutation boundary.`);
  }
}

function within<T>(work: Promise<T>, message: string, milliseconds = RACE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    void work.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

function marker(label: string): string {
  return `integration-${label}-${randomUUID()}`;
}

function pauseAfterFirstFindUnique(
  transaction: Prisma.TransactionClient,
  delegateName: "project" | "post" | "education" | "workExperience",
  barrier: TwoPartyBarrier,
): Prisma.TransactionClient {
  let paused = false;

  return new Proxy(transaction, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (property !== delegateName || typeof member !== "object" || member === null) {
        return typeof member === "function" ? member.bind(target) : member;
      }

      return new Proxy(member, {
        get(delegate, method) {
          const delegateMember = Reflect.get(delegate, method, delegate);
          if (method === "findUnique" && typeof delegateMember === "function") {
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(delegateMember, delegate, args);
              if (!paused) {
                paused = true;
                await barrier.wait();
              }
              return result;
            };
          }
          return typeof delegateMember === "function"
            ? delegateMember.bind(delegate)
            : delegateMember;
        },
      });
    },
  }) as Prisma.TransactionClient;
}

function projectInput(title: string, slug: string): ProjectInputData {
  return {
    title,
    slug,
    summary: "Integration concurrency fixture.",
    description: null,
    categoryId: null,
    featured: false,
    sortOrder: 0,
    status: "DRAFT",
  };
}

async function createEducationFixture(suffix: string): Promise<{ id: string; version: number }> {
  return inspector.education.create({
    data: {
      institution: `${suffix} institution`,
      program: "Integration program",
      fieldOfStudy: null,
      description: "Original.",
      startDate: null,
      endDate: null,
      isCurrent: false,
      status: "DRAFT",
      sortOrder: 0,
    },
    select: { id: true, version: true },
  });
}

async function createWorkExperienceFixture(suffix: string): Promise<{ id: string; version: number }> {
  return inspector.workExperience.create({
    data: {
      employer: `${suffix} company`,
      roleTitle: "Integration role",
      employmentType: "OTHER",
      location: null,
      description: "Original.",
      startDate: new Date("2020-01-01T00:00:00.000Z"),
      endDate: new Date("2021-01-01T00:00:00.000Z"),
      currentPosition: false,
      status: "DRAFT",
      sortOrder: 0,
    },
    select: { id: true, version: true },
  });
}

async function runTransaction<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(operation, TRANSACTION_OPTIONS);
}

async function removeExactFixtures(fixtures: {
  projectIds?: string[];
  postIds?: string[];
  tagIds?: string[];
  categoryIds?: string[];
  educationIds?: string[];
  experienceIds?: string[];
}): Promise<void> {
  if (fixtures.projectIds?.length) {
    await inspector.project.deleteMany({ where: { id: { in: fixtures.projectIds } } });
  }
  if (fixtures.postIds?.length) {
    await inspector.post.deleteMany({ where: { id: { in: fixtures.postIds } } });
  }
  if (fixtures.tagIds?.length) {
    await inspector.tag.deleteMany({ where: { id: { in: fixtures.tagIds } } });
  }
  if (fixtures.categoryIds?.length) {
    await inspector.postCategory.deleteMany({ where: { id: { in: fixtures.categoryIds } } });
  }
  if (fixtures.educationIds?.length) {
    await inspector.education.deleteMany({ where: { id: { in: fixtures.educationIds } } });
  }
  if (fixtures.experienceIds?.length) {
    await inspector.workExperience.deleteMany({ where: { id: { in: fixtures.experienceIds } } });
  }
}

before(async () => {
  [clientA, clientB, inspector] = await Promise.all([
    createIsolatedIntegrationPrismaClient(),
    createIsolatedIntegrationPrismaClient(),
    createIsolatedIntegrationPrismaClient(),
  ]);
});

after(async () => {
  await Promise.all([
    clientA?.$disconnect(),
    clientB?.$disconnect(),
    inspector?.$disconnect(),
  ]);
});

test("PostgreSQL Project compare-and-swap permits exactly one concurrent version-1 update", { timeout: 30_000 }, async () => {
  const suffix = marker("project");
  let projectId: string | undefined;

  try {
    const project = await inspector.project.create({
      data: {
        title: `${suffix} original`,
        slug: `${suffix}-original`,
        summary: "Integration concurrency fixture.",
        description: null,
        categoryId: null,
        featured: false,
        sortOrder: 0,
        status: "DRAFT",
      },
      select: { id: true, version: true },
    });
    projectId = project.id;
    assert.equal(project.version, 1);

    const barrier = new TwoPartyBarrier("Project version-1 update race");
    const firstInput = projectInput(`${suffix} first`, `${suffix}-first`);
    const secondInput = projectInput(`${suffix} second`, `${suffix}-second`);
    const results = await within(Promise.all([
      runTransaction(clientA, (transaction) => updateProjectInTransaction(
        pauseAfterFirstFindUnique(transaction, "project", barrier),
        project.id,
        firstInput,
        1,
        new Date(),
      )),
      runTransaction(clientB, (transaction) => updateProjectInTransaction(
        pauseAfterFirstFindUnique(transaction, "project", barrier),
        project.id,
        secondInput,
        1,
        new Date(),
      )),
    ]), "Project concurrent update race timed out.");

    const winners = results.filter((result) => result.kind === "updated");
    const conflicts = results.filter((result) => result.kind === "conflict");
    assert.equal(winners.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(winners[0]?.project.version, 2);

    const finalProject = await inspector.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { title: true, slug: true, version: true },
    });
    assert.equal(finalProject.version, 2);
    assert.ok(
      (finalProject.title === firstInput.title && finalProject.slug === firstInput.slug) ||
      (finalProject.title === secondInput.title && finalProject.slug === secondInput.slug),
    );
  } finally {
    await removeExactFixtures({ projectIds: projectId ? [projectId] : [] });
  }
});

test("PostgreSQL Project stale deletion cannot remove a Project updated by another client", { timeout: 30_000 }, async () => {
  const suffix = marker("project-stale-delete");
  let projectId: string | undefined;

  try {
    const project = await inspector.project.create({
      data: {
        title: `${suffix} original`,
        slug: `${suffix}-original`,
        summary: "Integration concurrency fixture.",
        description: null,
        categoryId: null,
        featured: false,
        sortOrder: 0,
        status: "DRAFT",
      },
      select: { id: true, version: true },
    });
    projectId = project.id;

    const updated = await runTransaction(clientA, (transaction) => updateProjectInTransaction(
      transaction,
      project.id,
      projectInput(`${suffix} current`, `${suffix}-current`),
      project.version,
      new Date(),
    ));
    assert.equal(updated.kind, "updated");
    if (updated.kind !== "updated") return;
    assert.equal(updated.project.version, 2);

    const staleDelete = await handleProjectDelete(
      new Request(`https://example.test/api/admin/projects/${project.id}`, {
        method: "DELETE",
        headers: { "If-Match": `\"${project.version}\"` },
      }),
      project.id,
      {
        authorize: async () => null,
        delete: (id, expectedVersion) => runTransaction(clientB, (transaction) =>
          deleteProjectWithVersion(transaction, id, expectedVersion)),
      },
    );
    assert.equal(staleDelete.status, 409);
    assert.match((await staleDelete.json() as { error: string }).error, /changed since it was listed/u);

    const persisted = await inspector.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { title: true, slug: true, version: true },
    });
    assert.equal(persisted.title, `${suffix} current`);
    assert.equal(persisted.slug, `${suffix}-current`);
    assert.equal(persisted.version, 2);
  } finally {
    await removeExactFixtures({ projectIds: projectId ? [projectId] : [] });
  }
});

test("PostgreSQL Project versioned deletes allow one winner and preserve unrelated Projects", { timeout: 30_000 }, async () => {
  const suffix = marker("project-delete");
  let victimId: string | undefined;
  let unrelatedId: string | undefined;

  try {
    const [victim, unrelated] = await Promise.all([
      inspector.project.create({
        data: {
          title: `${suffix} victim`,
          slug: `${suffix}-victim`,
          summary: "Victim fixture.",
          description: null,
          categoryId: null,
          featured: false,
          sortOrder: 0,
          status: "DRAFT",
        },
        select: { id: true, version: true },
      }),
      inspector.project.create({
        data: {
          title: `${suffix} unrelated`,
          slug: `${suffix}-unrelated`,
          summary: "Unrelated fixture.",
          description: null,
          categoryId: null,
          featured: false,
          sortOrder: 1,
          status: "DRAFT",
        },
        select: { id: true },
      }),
    ]);
    victimId = victim.id;
    unrelatedId = unrelated.id;

    const barrier = new TwoPartyBarrier("Project version-1 delete race");
    const results = await within(Promise.all([
      runTransaction(clientA, async (transaction) => {
        await barrier.wait();
        return deleteProjectWithVersion(transaction, victim.id, victim.version);
      }),
      runTransaction(clientB, async (transaction) => {
        await barrier.wait();
        return deleteProjectWithVersion(transaction, victim.id, victim.version);
      }),
    ]), "Project concurrent delete race timed out.");

    assert.equal(results.filter((result) => result.kind === "deleted").length, 1);
    assert.equal(results.filter((result) => result.kind === "missing" || result.kind === "conflict").length, 1);
    assert.equal(await inspector.project.findUnique({ where: { id: victim.id } }), null);
    assert.ok(await inspector.project.findUnique({ where: { id: unrelated.id } }));
  } finally {
    await removeExactFixtures({
      projectIds: [victimId, unrelatedId].filter((id): id is string => Boolean(id)),
    });
  }
});

test("PostgreSQL Blog Post compare-and-swap permits exactly one concurrent version-1 update", { timeout: 30_000 }, async () => {
  const suffix = marker("post-update");
  let postId: string | undefined;

  try {
    const post = await inspector.post.create({
      data: { title: `${suffix} original`, slug: `${suffix}-original`, body: "Original.", status: "DRAFT" },
      select: { id: true, version: true },
    });
    postId = post.id;
    assert.equal(post.version, 1);

    const barrier = new TwoPartyBarrier("Blog Post version-1 update race");
    const firstInput: BlogPostInputData = { title: `${suffix} first` };
    const secondInput: BlogPostInputData = { title: `${suffix} second` };
    const results = await within(Promise.all([
      runTransaction(clientA, (transaction) => updateBlogPostInTransaction(
        pauseAfterFirstFindUnique(transaction, "post", barrier), post.id, firstInput, 1, new Date(),
      )),
      runTransaction(clientB, (transaction) => updateBlogPostInTransaction(
        pauseAfterFirstFindUnique(transaction, "post", barrier), post.id, secondInput, 1, new Date(),
      )),
    ]), "Blog Post concurrent update race timed out.");

    const winners = results.filter((result) => result.kind === "updated");
    const conflicts = results.filter((result) => result.kind === "conflict");
    assert.equal(winners.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(winners[0]?.post.version, 2);

    const finalPost = await inspector.post.findUniqueOrThrow({
      where: { id: post.id },
      select: { title: true, version: true },
    });
    assert.equal(finalPost.version, 2);
    assert.ok(finalPost.title === firstInput.title || finalPost.title === secondInput.title);
  } finally {
    await removeExactFixtures({ postIds: postId ? [postId] : [] });
  }
});

test("PostgreSQL Blog Post versioned deletes remove only one target record", { timeout: 30_000 }, async () => {
  const suffix = marker("post-delete");
  let victimId: string | undefined;
  let unrelatedId: string | undefined;

  try {
    const [victim, unrelated] = await Promise.all([
      inspector.post.create({
        data: { title: `${suffix} victim`, slug: `${suffix}-victim`, body: "Victim.", status: "DRAFT" },
        select: { id: true, version: true },
      }),
      inspector.post.create({
        data: { title: `${suffix} unrelated`, slug: `${suffix}-unrelated`, body: "Unrelated.", status: "DRAFT" },
        select: { id: true },
      }),
    ]);
    victimId = victim.id;
    unrelatedId = unrelated.id;

    const barrier = new TwoPartyBarrier("Blog Post version-1 delete race");
    const results = await within(Promise.all([
      runTransaction(clientA, async (transaction) => {
        await barrier.wait();
        return deleteBlogPostWithVersion(transaction, victim.id, victim.version);
      }),
      runTransaction(clientB, async (transaction) => {
        await barrier.wait();
        return deleteBlogPostWithVersion(transaction, victim.id, victim.version);
      }),
    ]), "Blog Post concurrent delete race timed out.");

    assert.equal(results.filter((result) => result.kind === "deleted").length, 1);
    assert.equal(results.filter((result) => result.kind === "missing" || result.kind === "conflict").length, 1);
    assert.equal(await inspector.post.findUnique({ where: { id: victim.id } }), null);
    assert.ok(await inspector.post.findUnique({ where: { id: unrelated.id } }));
  } finally {
    await removeExactFixtures({ postIds: [victimId, unrelatedId].filter((id): id is string => Boolean(id)) });
  }
});

test("PostgreSQL category deletion racing a Post update leaves an atomic, versioned final state", { timeout: 30_000 }, async () => {
  const suffix = marker("category-race");
  let categoryId: string | undefined;
  let postId: string | undefined;

  try {
    const category = await inspector.postCategory.create({
      data: { name: `${suffix} category`, slug: `${suffix}-category`, sortOrder: 0 },
      select: { id: true },
    });
    categoryId = category.id;
    const post = await inspector.post.create({
      data: {
        title: `${suffix} post`,
        slug: `${suffix}-post`,
        body: "Category race fixture.",
        categoryId: category.id,
        status: "DRAFT",
      },
      select: { id: true },
    });
    postId = post.id;

    const barrier = new TwoPartyBarrier("Blog category update/delete race");
    const update = runTransaction(clientA, async (transaction) => {
      await barrier.wait();
      try {
        return await updateBlogPostInTransaction(
          transaction,
          post.id,
          { title: `${suffix} updated`, categoryId: category.id },
          1,
          new Date(),
        );
      } catch (error) {
        if (error instanceof BlogCategoryMissingError) return "category-missing" as const;
        throw error;
      }
    });
    const deletion = runTransaction(clientB, async (transaction) => {
      await barrier.wait();
      return deleteBlogCategoryWithPosts(transaction, category.id);
    });
    const [updateResult, deletionResult] = await within(
      Promise.all([update, deletion]),
      "Blog category update/delete race timed out.",
    );

    assert.ok(deletionResult);
    const finalPost = await inspector.post.findUniqueOrThrow({
      where: { id: post.id },
      select: { title: true, categoryId: true, version: true },
    });
    assert.equal(await inspector.postCategory.findUnique({ where: { id: category.id } }), null);
    assert.equal(finalPost.categoryId, null);
    assert.ok(finalPost.version === 2 || finalPost.version === 3);
    if (updateResult !== "category-missing" && updateResult.kind === "updated") {
      assert.equal(finalPost.title, `${suffix} updated`);
      assert.equal(finalPost.version, 3);
    } else {
      assert.equal(finalPost.title, `${suffix} post`);
      assert.equal(finalPost.version, 2);
    }
  } finally {
    await removeExactFixtures({
      postIds: postId ? [postId] : [],
      categoryIds: categoryId ? [categoryId] : [],
    });
  }
});

test("PostgreSQL tag deletion racing a Post update leaves no orphaned association or partial version", { timeout: 30_000 }, async () => {
  const suffix = marker("tag-race");
  let tagId: string | undefined;
  let postId: string | undefined;

  try {
    const tag = await inspector.tag.create({
      data: { name: `${suffix} tag`, slug: `${suffix}-tag` },
      select: { id: true },
    });
    tagId = tag.id;
    const post = await inspector.post.create({
      data: { title: `${suffix} post`, slug: `${suffix}-post`, body: "Tag race fixture.", status: "DRAFT" },
      select: { id: true },
    });
    postId = post.id;
    await inspector.postTag.create({ data: { postId: post.id, tagId: tag.id } });

    const barrier = new TwoPartyBarrier("Blog tag update/delete race");
    const update = runTransaction(clientA, async (transaction) => {
      await barrier.wait();
      try {
        return await updateBlogPostInTransaction(
          transaction,
          post.id,
          { title: `${suffix} updated`, tagIds: [tag.id] },
          1,
          new Date(),
        );
      } catch (error) {
        if (error instanceof BlogTagsMissingError) return "tag-missing" as const;
        throw error;
      }
    });
    const deletion = runTransaction(clientB, async (transaction) => {
      await barrier.wait();
      return deleteBlogTagWithAssociations(transaction, tag.id);
    });
    const [updateResult, deletionResult] = await within(
      Promise.all([update, deletion]),
      "Blog tag update/delete race timed out.",
    );

    assert.ok(deletionResult);
    const finalPost = await inspector.post.findUniqueOrThrow({
      where: { id: post.id },
      select: { title: true, version: true, tags: { select: { tagId: true } } },
    });
    assert.equal(await inspector.tag.findUnique({ where: { id: tag.id } }), null);
    assert.deepEqual(finalPost.tags, []);
    assert.ok(finalPost.version === 2 || finalPost.version === 3);
    if (updateResult !== "tag-missing" && updateResult.kind === "updated") {
      assert.equal(finalPost.title, `${suffix} updated`);
      assert.equal(finalPost.version, 3);
    } else {
      assert.equal(finalPost.title, `${suffix} post`);
      assert.equal(finalPost.version, 2);
    }
  } finally {
    await removeExactFixtures({
      postIds: postId ? [postId] : [],
      tagIds: tagId ? [tagId] : [],
    });
  }
});

test("PostgreSQL overlapping tag deletions commit complete versioned results without deadlock", { timeout: 30_000 }, async () => {
  const suffix = marker("overlapping-tags");
  const postIds: string[] = [];
  const tagIds: string[] = [];

  try {
    const [firstTag, secondTag] = await Promise.all([
      inspector.tag.create({ data: { name: `${suffix} first`, slug: `${suffix}-first` }, select: { id: true } }),
      inspector.tag.create({ data: { name: `${suffix} second`, slug: `${suffix}-second` }, select: { id: true } }),
    ]);
    tagIds.push(firstTag.id, secondTag.id);
    const [firstPost, secondPost] = await Promise.all([
      inspector.post.create({ data: { title: `${suffix} post one`, slug: `${suffix}-post-one`, body: "First.", status: "DRAFT" }, select: { id: true } }),
      inspector.post.create({ data: { title: `${suffix} post two`, slug: `${suffix}-post-two`, body: "Second.", status: "DRAFT" }, select: { id: true } }),
    ]);
    postIds.push(firstPost.id, secondPost.id);
    await inspector.postTag.createMany({
      data: [
        { postId: firstPost.id, tagId: firstTag.id },
        { postId: firstPost.id, tagId: secondTag.id },
        { postId: secondPost.id, tagId: firstTag.id },
        { postId: secondPost.id, tagId: secondTag.id },
      ],
    });

    const barrier = new TwoPartyBarrier("Overlapping Blog tag deletion race");
    const [firstDeletion, secondDeletion] = await within(Promise.all([
      runTransaction(clientA, async (transaction) => {
        await barrier.wait();
        return deleteBlogTagWithAssociations(transaction, firstTag.id);
      }),
      runTransaction(clientB, async (transaction) => {
        await barrier.wait();
        return deleteBlogTagWithAssociations(transaction, secondTag.id);
      }),
    ]), "Overlapping Blog tag deletion race timed out.");

    assert.ok(firstDeletion);
    assert.ok(secondDeletion);
    assert.equal(firstDeletion.removedAssociationCount, 2);
    assert.equal(secondDeletion.removedAssociationCount, 2);
    assert.equal(firstDeletion.affectedPosts.length, 2);
    assert.equal(secondDeletion.affectedPosts.length, 2);
    assert.equal(await inspector.tag.count({ where: { id: { in: tagIds } } }), 0);

    const finalPosts = await inspector.post.findMany({
      where: { id: { in: postIds } },
      select: { id: true, version: true, tags: { select: { tagId: true } } },
    });
    assert.equal(finalPosts.length, 2);
    for (const post of finalPosts) {
      assert.equal(post.version, 3);
      assert.deepEqual(post.tags, []);
    }
  } finally {
    await removeExactFixtures({ postIds, tagIds });
  }
});

test("PostgreSQL Education compare-and-swap permits exactly one concurrent version-1 update", { timeout: 30_000 }, async () => {
  const suffix = marker("education");
  let educationId: string | undefined;

  try {
    const education = await inspector.education.create({
      data: {
        institution: `${suffix} institution`,
        program: "Integration program",
        fieldOfStudy: null,
        description: "Original.",
        startDate: null,
        endDate: null,
        isCurrent: false,
        status: "DRAFT",
        sortOrder: 0,
      },
      select: { id: true, version: true },
    });
    educationId = education.id;
    const barrier = new TwoPartyBarrier("Education version-1 update race");
    const firstPatch: EducationPatchData = { description: `${suffix} first` };
    const secondPatch: EducationPatchData = { description: `${suffix} second` };
    const results = await within(Promise.all([
      runTransaction(clientA, (transaction) => updateEducationInTransaction(
        pauseAfterFirstFindUnique(transaction, "education", barrier), education.id, firstPatch, 1, new Date(),
      )),
      runTransaction(clientB, (transaction) => updateEducationInTransaction(
        pauseAfterFirstFindUnique(transaction, "education", barrier), education.id, secondPatch, 1, new Date(),
      )),
    ]), "Education concurrent update race timed out.");

    assert.equal(results.filter((result) => result.kind === "updated").length, 1);
    assert.equal(results.filter((result) => result.kind === "conflict").length, 1);
    const finalEducation = await inspector.education.findUniqueOrThrow({
      where: { id: education.id },
      select: { description: true, version: true },
    });
    assert.equal(finalEducation.version, 2);
    assert.ok(finalEducation.description === firstPatch.description || finalEducation.description === secondPatch.description);
  } finally {
    await removeExactFixtures({ educationIds: educationId ? [educationId] : [] });
  }
});

test("PostgreSQL Education stale deletion preserves the updated record", { timeout: 30_000 }, async () => {
  const suffix = marker("education-stale-delete");
  let educationId: string | undefined;

  try {
    const education = await createEducationFixture(suffix);
    educationId = education.id;
    const updated = await runTransaction(clientA, (transaction) =>
      updateEducationInTransaction(
        transaction,
        education.id,
        { description: `${suffix} updated` },
        education.version,
        new Date(),
      ));
    assert.equal(updated.kind, "updated");
    if (updated.kind !== "updated") return;
      assert.ok(updated.education);
      assert.equal(updated.education.version, 2);

    const response = await handleEducationDelete(
      new Request(`https://example.test/api/admin/education/${education.id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${education.version}"` },
      }),
      education.id,
      {
        authorize: async () => null,
        delete: (id, expectedVersion) => runTransaction(clientB, (transaction) =>
          deleteEducationWithVersion(transaction, id, expectedVersion)),
      },
    );
    assert.equal(response.status, 409);
    assert.match((await response.json() as { error: string }).error, /was not deleted/u);

    const persisted = await inspector.education.findUniqueOrThrow({
      where: { id: education.id },
      select: { description: true, version: true },
    });
    assert.equal(persisted.description, `${suffix} updated`);
    assert.equal(persisted.version, 2);
  } finally {
    await removeExactFixtures({ educationIds: educationId ? [educationId] : [] });
  }
});

test("PostgreSQL Education concurrent deletes have one winner", { timeout: 30_000 }, async () => {
  const educationIds: string[] = [];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const education = await createEducationFixture(marker(`education-delete-${attempt}`));
      educationIds.push(education.id);
      const barrier = new TwoPartyBarrier(`Education delete race ${attempt}`);
      const results = await within(Promise.all([
        runTransaction(clientA, async (transaction) => {
          await barrier.wait();
          return deleteEducationWithVersion(transaction, education.id, education.version);
        }),
        runTransaction(clientB, async (transaction) => {
          await barrier.wait();
          return deleteEducationWithVersion(transaction, education.id, education.version);
        }),
      ]), "Education concurrent delete race timed out.");

      assert.equal(results.filter((result) => result.kind === "deleted").length, 1);
      assert.equal(results.filter((result) => result.kind === "missing" || result.kind === "conflict").length, 1);
      assert.equal(await inspector.education.findUnique({ where: { id: education.id } }), null);
    }
  } finally {
    await removeExactFixtures({ educationIds });
  }
});

test("PostgreSQL Education update racing delete cannot stale-delete or partially update", { timeout: 30_000 }, async () => {
  const educationIds: string[] = [];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const suffix = marker(`education-update-delete-${attempt}`);
      const education = await createEducationFixture(suffix);
      educationIds.push(education.id);
      const barrier = new TwoPartyBarrier(`Education update-delete race ${attempt}`);
      const [update, deletion] = await within(Promise.all([
        runTransaction(clientA, async (transaction) => {
          await barrier.wait();
          return updateEducationInTransaction(
            transaction,
            education.id,
            { description: `${suffix} updated` },
            education.version,
            new Date(),
          );
        }),
        runTransaction(clientB, async (transaction) => {
          await barrier.wait();
          return deleteEducationWithVersion(transaction, education.id, education.version);
        }),
      ]), "Education update-delete race timed out.");

      if (deletion.kind === "deleted") {
        assert.equal(update.kind, "missing");
        assert.equal(await inspector.education.findUnique({ where: { id: education.id } }), null);
      } else {
        assert.equal(deletion.kind, "conflict");
        assert.equal(update.kind, "updated");
        const persisted = await inspector.education.findUniqueOrThrow({
          where: { id: education.id },
          select: { description: true, version: true },
        });
        assert.equal(persisted.description, `${suffix} updated`);
        assert.equal(persisted.version, 2);
      }
    }
  } finally {
    await removeExactFixtures({ educationIds });
  }
});

test("PostgreSQL Work Experience compare-and-swap permits exactly one concurrent version-1 update", { timeout: 30_000 }, async () => {
  const suffix = marker("experience");
  let experienceId: string | undefined;

  try {
    const experience = await inspector.workExperience.create({
      data: {
        employer: `${suffix} company`,
        roleTitle: "Integration role",
        employmentType: "OTHER",
        location: null,
        description: "Original.",
        startDate: new Date("2020-01-01T00:00:00.000Z"),
        endDate: new Date("2021-01-01T00:00:00.000Z"),
        currentPosition: false,
        status: "DRAFT",
        sortOrder: 0,
      },
      select: { id: true, version: true },
    });
    experienceId = experience.id;
    const barrier = new TwoPartyBarrier("Work Experience version-1 update race");
    const firstPatch: WorkExperiencePatchData = { description: `${suffix} first` };
    const secondPatch: WorkExperiencePatchData = { description: `${suffix} second` };
    const results = await within(Promise.all([
      runTransaction(clientA, (transaction) => updateWorkExperienceInTransaction(
        pauseAfterFirstFindUnique(transaction, "workExperience", barrier), experience.id, firstPatch, 1, new Date(),
      )),
      runTransaction(clientB, (transaction) => updateWorkExperienceInTransaction(
        pauseAfterFirstFindUnique(transaction, "workExperience", barrier), experience.id, secondPatch, 1, new Date(),
      )),
    ]), "Work Experience concurrent update race timed out.");

    assert.equal(results.filter((result) => result.kind === "updated").length, 1);
    assert.equal(results.filter((result) => result.kind === "conflict").length, 1);
    const finalExperience = await inspector.workExperience.findUniqueOrThrow({
      where: { id: experience.id },
      select: { description: true, version: true },
    });
    assert.equal(finalExperience.version, 2);
    assert.ok(finalExperience.description === firstPatch.description || finalExperience.description === secondPatch.description);
  } finally {
    await removeExactFixtures({ experienceIds: experienceId ? [experienceId] : [] });
  }
});

test("PostgreSQL Work Experience stale deletion preserves the updated record", { timeout: 30_000 }, async () => {
  const suffix = marker("experience-stale-delete");
  let experienceId: string | undefined;

  try {
    const experience = await createWorkExperienceFixture(suffix);
    experienceId = experience.id;
    const updated = await runTransaction(clientA, (transaction) =>
      updateWorkExperienceInTransaction(
        transaction,
        experience.id,
        { description: `${suffix} updated` },
        experience.version,
        new Date(),
      ));
    assert.equal(updated.kind, "updated");
    if (updated.kind !== "updated") return;
    assert.ok(updated.experience);
    assert.equal(updated.experience.version, 2);

    const response = await handleWorkExperienceDelete(
      new Request(`https://example.test/api/admin/experience/${experience.id}`, {
        method: "DELETE",
        headers: { "If-Match": `"${experience.version}"` },
      }),
      experience.id,
      {
        authorize: async () => null,
        delete: (id, expectedVersion) => runTransaction(clientB, (transaction) =>
          deleteWorkExperienceWithVersion(transaction, id, expectedVersion)),
      },
    );
    assert.equal(response.status, 409);
    assert.match((await response.json() as { error: string }).error, /was not deleted/u);

    const persisted = await inspector.workExperience.findUniqueOrThrow({
      where: { id: experience.id },
      select: { description: true, version: true },
    });
    assert.equal(persisted.description, `${suffix} updated`);
    assert.equal(persisted.version, 2);
  } finally {
    await removeExactFixtures({ experienceIds: experienceId ? [experienceId] : [] });
  }
});

test("PostgreSQL Work Experience concurrent deletes have one winner", { timeout: 30_000 }, async () => {
  const experienceIds: string[] = [];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const experience = await createWorkExperienceFixture(marker(`experience-delete-${attempt}`));
      experienceIds.push(experience.id);
      const barrier = new TwoPartyBarrier(`Work Experience delete race ${attempt}`);
      const results = await within(Promise.all([
        runTransaction(clientA, async (transaction) => {
          await barrier.wait();
          return deleteWorkExperienceWithVersion(transaction, experience.id, experience.version);
        }),
        runTransaction(clientB, async (transaction) => {
          await barrier.wait();
          return deleteWorkExperienceWithVersion(transaction, experience.id, experience.version);
        }),
      ]), "Work Experience concurrent delete race timed out.");

      assert.equal(results.filter((result) => result.kind === "deleted").length, 1);
      assert.equal(results.filter((result) => result.kind === "missing" || result.kind === "conflict").length, 1);
      assert.equal(await inspector.workExperience.findUnique({ where: { id: experience.id } }), null);
    }
  } finally {
    await removeExactFixtures({ experienceIds });
  }
});

test("PostgreSQL Work Experience update racing delete cannot stale-delete or partially update", { timeout: 30_000 }, async () => {
  const experienceIds: string[] = [];

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const suffix = marker(`experience-update-delete-${attempt}`);
      const experience = await createWorkExperienceFixture(suffix);
      experienceIds.push(experience.id);
      const barrier = new TwoPartyBarrier(`Work Experience update-delete race ${attempt}`);
      const [update, deletion] = await within(Promise.all([
        runTransaction(clientA, async (transaction) => {
          await barrier.wait();
          return updateWorkExperienceInTransaction(
            transaction,
            experience.id,
            { description: `${suffix} updated` },
            experience.version,
            new Date(),
          );
        }),
        runTransaction(clientB, async (transaction) => {
          await barrier.wait();
          return deleteWorkExperienceWithVersion(transaction, experience.id, experience.version);
        }),
      ]), "Work Experience update-delete race timed out.");

      if (deletion.kind === "deleted") {
        assert.equal(update.kind, "missing");
        assert.equal(await inspector.workExperience.findUnique({ where: { id: experience.id } }), null);
      } else {
        assert.equal(deletion.kind, "conflict");
        assert.equal(update.kind, "updated");
        const persisted = await inspector.workExperience.findUniqueOrThrow({
          where: { id: experience.id },
          select: { description: true, version: true },
        });
        assert.equal(persisted.description, `${suffix} updated`);
        assert.equal(persisted.version, 2);
      }
    }
  } finally {
    await removeExactFixtures({ experienceIds });
  }
});
