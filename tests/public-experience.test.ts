import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  publishedExperienceQuery,
  readPublishedWorkExperiences,
  type PublicWorkExperience,
} from "../src/lib/public-experience-query";
import { formatWorkExperienceDateRange } from "../src/lib/public-experience-format";

function experience(overrides: Partial<PublicWorkExperience> = {}): PublicWorkExperience {
  return {
    employer: "Example Organization",
    roleTitle: "Software Engineer",
    location: "Remote",
    description: "Maintained software.",
    startDate: new Date("2022-01-15T00:00:00.000Z"),
    endDate: new Date("2024-06-30T00:00:00.000Z"),
    isCurrent: false,
    ...overrides,
  };
}

test("public query filters for published records with a non-null publication date", async () => {
  assert.deepEqual(publishedExperienceQuery.where, {
    status: "PUBLISHED",
    publishedAt: { not: null },
  });

  const candidates = [
    { status: "DRAFT", publishedAt: new Date(), record: experience({ roleTitle: "Draft role" }) },
    { status: "ARCHIVED", publishedAt: new Date(), record: experience({ roleTitle: "Archived role" }) },
    { status: "PUBLISHED", publishedAt: null, record: experience({ roleTitle: "Undated publication" }) },
    { status: "PUBLISHED", publishedAt: new Date(), record: experience({ roleTitle: "Published role" }) },
  ];

  const result = await readPublishedWorkExperiences(async (query) =>
    candidates
      .filter(({ status, publishedAt }) =>
        status === query.where.status && publishedAt !== null,
      )
      .map(({ record }) => record),
  );

  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.deepEqual(result.experiences.map(({ roleTitle }) => roleTitle), ["Published role"]);
  }
});

test("public query uses deterministic sort order and selects only displayed fields", () => {
  assert.deepEqual(publishedExperienceQuery.orderBy, [
    { sortOrder: "asc" },
    { startDate: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ]);
  assert.deepEqual(Object.keys(publishedExperienceQuery.select).sort(), [
    "description", "employer", "endDate", "isCurrent", "location", "roleTitle", "startDate",
  ]);
  assert.equal("id" in publishedExperienceQuery.select, false);
  assert.equal("status" in publishedExperienceQuery.select, false);
  assert.equal("publishedAt" in publishedExperienceQuery.select, false);
  assert.equal("sortOrder" in publishedExperienceQuery.select, false);
});

test("empty published experience results are a successful empty state", async () => {
  const result = await readPublishedWorkExperiences(async () => []);
  assert.deepEqual(result, { kind: "success", experiences: [] });
});

test("database failures return an unavailable result without internal error details", async () => {
  const result = await readPublishedWorkExperiences(async () => {
    throw new Error("private database connection detail");
  });
  assert.deepEqual(result, { kind: "unavailable" });
});

test("date formatting covers current, historical, and absent dates", () => {
  const current = formatWorkExperienceDateRange({
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: null,
    isCurrent: true,
  });
  assert.equal(current, "January 2024 – Present");

  const historical = formatWorkExperienceDateRange({
    startDate: new Date("2022-01-01T00:00:00.000Z"),
    endDate: new Date("2023-12-01T00:00:00.000Z"),
    isCurrent: false,
  });
  assert.equal(historical, "January 2022 – December 2023");

  const missing = formatWorkExperienceDateRange({ startDate: null, endDate: null, isCurrent: false });
  assert.equal(missing, "Date not provided – Date not provided");
});

test("optional public location and description stay absent when not supplied", () => {
  const record = experience({ location: null, description: null });
  assert.equal(record.location, null);
  assert.equal(record.description, null);
});

test("experience descriptions render as escaped text with line breaks retained by CSS", () => {
  const description = "<script>alert('no')</script>\nSecond line with <em>plain text</em>.";
  const renderer = [
    "import { createElement } from 'react';",
    "import { renderToStaticMarkup } from 'react-dom/server';",
    `const description = ${JSON.stringify(description)};`,
    "console.log(renderToStaticMarkup(createElement('p', { className: 'public-experience__description' }, description)));",
  ].join("\n");
  const markup = execFileSync(process.execPath, ["--input-type=module", "--eval", renderer], {
    encoding: "utf8",
  });

  assert.match(markup, /&lt;script&gt;/u);
  assert.match(markup, /&lt;em&gt;plain text&lt;\/em&gt;/u);
  assert.doesNotMatch(markup, /<script>|<em>/u);
  assert.match(markup, /public-experience__description/u);
});
