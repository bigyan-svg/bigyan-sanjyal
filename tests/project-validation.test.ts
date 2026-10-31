import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECT_IMAGE_ALT_MAX_LENGTH,
  PROJECT_SORT_ORDER_MAX,
  parseProjectInput,
} from "../src/lib/project-validation";

const skillId = "123e4567-e89b-42d3-a456-426614174000";

function projectInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Sample Project",
    slug: "sample-project",
    summary: "A confirmed project summary.",
    description: "",
    categoryId: "",
    featured: false,
    sortOrder: 0,
    status: "DRAFT",
    ...overrides,
  };
}

test("project validation accepts skill associations, typed HTTPS links, and HTTPS images", () => {
  const parsed = parseProjectInput(projectInput({
    skillIds: [skillId],
    links: [{
      type: "GITHUB_REPOSITORY",
      label: "Source code",
      url: "https://github.com/example/project",
      sortOrder: 0,
    }],
    images: [{
      imageUrl: "https://cdn.example.test/project.png",
      altText: "Project dashboard overview",
      caption: "Dashboard overview",
      sortOrder: 0,
    }],
  }));

  assert.deepEqual(parsed.errors, {});
  assert.deepEqual(parsed.data?.skillIds, [skillId]);
  assert.equal(parsed.data?.links?.[0]?.type, "GITHUB_REPOSITORY");
  assert.equal(parsed.data?.links?.[0]?.url, "https://github.com/example/project");
  assert.equal(parsed.data?.images?.[0]?.altText, "Project dashboard overview");
});

test("project validation permits HTTP only for localhost links on draft projects", () => {
  const localDraft = parseProjectInput(projectInput({
    links: [{ type: "OTHER", label: "Local preview", url: "http://localhost:3000", sortOrder: 0 }],
  }));
  const externalDraft = parseProjectInput(projectInput({
    links: [{ type: "OTHER", label: "Preview", url: "http://example.com", sortOrder: 0 }],
  }));
  const localPublished = parseProjectInput(projectInput({
    status: "PUBLISHED",
    links: [{ type: "OTHER", label: "Preview", url: "http://localhost:3000", sortOrder: 0 }],
  }));

  assert.equal(localDraft.data?.links?.[0]?.url, "http://localhost:3000/");
  assert.match(externalDraft.errors.links ?? "", /HTTPS/u);
  assert.match(localPublished.errors.links ?? "", /HTTPS/u);
});

test("project validation rejects unsafe link schemes, malformed URLs, and duplicate links", () => {
  for (const url of ["javascript:alert(1)", "not a URL", "https://user:password@example.com/path"]) {
    const parsed = parseProjectInput(projectInput({
      links: [{ type: "OTHER", label: "Unsafe", url, sortOrder: 0 }],
    }));
    assert.ok(parsed.errors.links, `Expected ${url} to be rejected`);
  }

  const duplicate = parseProjectInput(projectInput({
    links: [
      { type: "OTHER", label: "First", url: "https://example.com/project", sortOrder: 0 },
      { type: "LIVE_DEMO", label: "Same host case", url: "https://EXAMPLE.com/project", sortOrder: 1 },
    ],
  }));
  assert.match(duplicate.errors.links ?? "", /duplicates/u);
});

test("project validation rejects unsafe images and invalid alternative text or order", () => {
  const unsafeImage = parseProjectInput(projectInput({
    images: [{ imageUrl: "http://images.example.test/a.png", altText: "Image", caption: "", sortOrder: 0 }],
  }));
  const missingAlt = parseProjectInput(projectInput({
    images: [{ imageUrl: "https://images.example.test/a.png", altText: " ", caption: "", sortOrder: 0 }],
  }));
  const longAlt = parseProjectInput(projectInput({
    images: [{ imageUrl: "https://images.example.test/a.png", altText: "a".repeat(PROJECT_IMAGE_ALT_MAX_LENGTH + 1), caption: "", sortOrder: 0 }],
  }));
  const badOrder = parseProjectInput(projectInput({
    images: [{ imageUrl: "https://images.example.test/a.png", altText: "Image", caption: "", sortOrder: PROJECT_SORT_ORDER_MAX + 1 }],
  }));

  assert.match(unsafeImage.errors.images ?? "", /HTTPS/u);
  assert.match(missingAlt.errors.images ?? "", /alternative text/u);
  assert.match(longAlt.errors.images ?? "", /alternative text/u);
  assert.match(badOrder.errors.images ?? "", /display order/u);
});

test("project validation rejects duplicate skill IDs and non-allowlisted fields", () => {
  const duplicateSkills = parseProjectInput(projectInput({ skillIds: [skillId, skillId] }));
  const unexpectedField = parseProjectInput(projectInput({ links: [], unknown: true }));

  assert.match(duplicateSkills.errors.skillIds ?? "", /once/u);
  assert.equal(unexpectedField.invalidShape, true);
});

test("project PATCH payloads can omit relations so existing links and images remain unchanged", () => {
  const parsed = parseProjectInput(projectInput());

  assert.ok(parsed.data);
  assert.equal(parsed.data.skillIds, undefined);
  assert.equal(parsed.data.links, undefined);
  assert.equal(parsed.data.images, undefined);
});
