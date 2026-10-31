import assert from "node:assert/strict";
import { test } from "node:test";
import {
  updateSkillCategory,
  type SkillCategoryUpdateData,
} from "../src/lib/skill-category-update";
import type { SkillCategoryItem } from "../src/lib/skill-types";

const categoryId = "123e4567-e89b-42d3-a456-426614174000";
const savedCategory: SkillCategoryItem = {
  id: categoryId,
  name: "Web Development",
  slug: "web-development",
  description: "Updated description",
  sortOrder: 1,
};

test("category updates save validated values and return the updated category", async () => {
  let captured: { id: string; data: SkillCategoryUpdateData } | null = null;
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "Updated description" },
    async (id, data) => {
      captured = { id, data };
      return savedCategory;
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { category: savedCategory });
  assert.deepEqual(captured, {
    id: categoryId,
    data: {
      name: "Web Development",
      description: "Updated description",
      slug: "web-development",
    },
  });
});

test("category updates reject malformed IDs before calling the database", async () => {
  let updateCalled = false;
  const response = await updateSkillCategory(
    "not-a-uuid",
    { name: "Web Development", description: "Updated description" },
    async () => {
      updateCalled = true;
      return savedCategory;
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Category not found." });
  assert.equal(updateCalled, false);
});

test("category updates reject invalid fields with field validation details", async () => {
  let updateCalled = false;
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "x".repeat(501) },
    async () => {
      updateCalled = true;
      return savedCategory;
    },
  );
  const result = await response.json();

  assert.equal(response.status, 422);
  assert.equal(typeof result, "object");
  assert.ok(result !== null && "fields" in result);
  assert.equal(updateCalled, false);
});

test("category updates reject unexpected request fields", async () => {
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "Updated description", slug: "ignored" },
    async () => savedCategory,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid category data." });
});

test("category updates report duplicate names or slugs as conflicts", async () => {
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "Updated description" },
    async () => {
      throw Object.assign(new Error("sensitive database detail"), { code: "P2002" });
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "A category with this name or generated URL already exists.",
  });
});

test("category updates report missing records without exposing database errors", async () => {
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "Updated description" },
    async () => {
      throw Object.assign(new Error("sensitive database detail"), { code: "P2025" });
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Category not found." });
});

test("category updates return a safe server error for unexpected database failures", async () => {
  const response = await updateSkillCategory(
    categoryId,
    { name: "Web Development", description: "Updated description" },
    async () => {
      throw new Error("sensitive database detail");
    },
  );
  const responseBody = await response.text();

  assert.equal(response.status, 500);
  assert.equal(responseBody.includes("sensitive database detail"), false);
  assert.equal(responseBody, JSON.stringify({ error: "Unable to update the category." }));
});

test("development diagnostics include safe error metadata without error messages", async () => {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnvironment.NODE_ENV;
  const originalConsoleError = console.error;
  let loggedDetails: unknown[] = [];

  mutableEnvironment.NODE_ENV = "development";
  console.error = (...details: unknown[]) => {
    loggedDetails = details;
  };

  try {
    await updateSkillCategory(
      categoryId,
      { name: "Web Development", description: "Updated description" },
      async () => {
        throw Object.assign(new Error("sensitive database detail"), { code: "P1001" });
      },
    );
  } finally {
    console.error = originalConsoleError;
    if (originalNodeEnv === undefined) {
      delete mutableEnvironment.NODE_ENV;
    } else {
      mutableEnvironment.NODE_ENV = originalNodeEnv;
    }
  }

  assert.deepEqual(loggedDetails, [
    "Admin skill category update failed.",
    { errorName: "Error", prismaCode: "P1001" },
  ]);
});
