import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  publishedEducationQuery,
  readPublishedEducation,
  type PublicEducation,
} from "../src/lib/public-education-query";
import { formatEducationDateRange } from "../src/lib/public-education-format";

function education(overrides: Partial<PublicEducation> = {}): PublicEducation {
  return {
    institution: "Example Institution",
    program: "Example Program",
    fieldOfStudy: "Computer Science",
    description: "Studied core subjects.",
    startDate: new Date("2022-01-01T00:00:00.000Z"),
    endDate: new Date("2024-06-01T00:00:00.000Z"),
    isCurrent: false,
    ...overrides,
  };
}

function renderEducationEntry(record: PublicEducation): string {
  const serializable = {
    ...record,
    startDate: record.startDate?.toISOString() ?? null,
    endDate: record.endDate?.toISOString() ?? null,
  };
  const renderer = [
    "import { createElement } from 'react';",
    "import { renderToStaticMarkup } from 'react-dom/server';",
    "import { EducationEntry } from './src/app/education/education-entry.tsx';",
    `const education = ${JSON.stringify(serializable)};`,
    "education.startDate = education.startDate ? new Date(education.startDate) : null;",
    "education.endDate = education.endDate ? new Date(education.endDate) : null;",
    "console.log(renderToStaticMarkup(createElement(EducationEntry, { education })));",
  ].join("\n");

  return execFileSync(process.execPath, ["--import=tsx", "--input-type=module", "--eval", renderer], {
    encoding: "utf8",
  });
}

test("public query includes only published records with a publication date", async () => {
  assert.deepEqual(publishedEducationQuery.where, {
    status: "PUBLISHED",
    publishedAt: { not: null },
  });

  const candidates = [
    { status: "DRAFT", publishedAt: new Date(), record: education({ program: "Draft program" }) },
    { status: "ARCHIVED", publishedAt: new Date(), record: education({ program: "Archived program" }) },
    { status: "PUBLISHED", publishedAt: null, record: education({ program: "Unpublished date" }) },
    { status: "PUBLISHED", publishedAt: new Date(), record: education({ program: "Published program" }) },
  ];

  const result = await readPublishedEducation(async (query) =>
    candidates
      .filter(({ status, publishedAt }) =>
        status === query.where.status && publishedAt !== null,
      )
      .map(({ record }) => record),
  );

  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.deepEqual(result.education.map(({ program }) => program), ["Published program"]);
  }
});

test("public query uses deterministic ordering and selects only public display fields", () => {
  assert.deepEqual(publishedEducationQuery.orderBy, [
    { sortOrder: "asc" },
    { startDate: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ]);
  assert.deepEqual(Object.keys(publishedEducationQuery.select).sort(), [
    "description", "endDate", "fieldOfStudy", "institution", "isCurrent", "program", "startDate",
  ]);
  assert.equal("id" in publishedEducationQuery.select, false);
  assert.equal("status" in publishedEducationQuery.select, false);
  assert.equal("publishedAt" in publishedEducationQuery.select, false);
  assert.equal("sortOrder" in publishedEducationQuery.select, false);
});

test("empty public education results remain a successful empty state", async () => {
  const result = await readPublishedEducation(async () => []);
  assert.deepEqual(result, { kind: "success", education: [] });
});

test("database failures return a safe unavailable result", async () => {
  const result = await readPublishedEducation(async () => {
    throw new Error("private database connection detail");
  });
  assert.deepEqual(result, { kind: "unavailable" });
  assert.equal(JSON.stringify(result).includes("private database"), false);
});

test("date ranges format current, historical, and nullable dates without inventing dates", () => {
  assert.equal(formatEducationDateRange({
    startDate: new Date("2024-01-01T00:00:00.000Z"),
    endDate: null,
    isCurrent: true,
  }), "January 2024 – Present");

  assert.equal(formatEducationDateRange({
    startDate: new Date("2022-01-01T00:00:00.000Z"),
    endDate: new Date("2023-12-01T00:00:00.000Z"),
    isCurrent: false,
  }), "January 2022 – December 2023");

  assert.equal(formatEducationDateRange({ startDate: null, endDate: null, isCurrent: true }), "Present");
  assert.equal(formatEducationDateRange({
    startDate: new Date("2022-01-01T00:00:00.000Z"),
    endDate: null,
    isCurrent: false,
  }), "From January 2022");
  assert.equal(formatEducationDateRange({
    startDate: null,
    endDate: new Date("2023-12-01T00:00:00.000Z"),
    isCurrent: false,
  }), "Through December 2023");
  assert.equal(formatEducationDateRange({ startDate: null, endDate: null, isCurrent: false }), null);
  assert.equal(formatEducationDateRange({
    startDate: new Date(Number.NaN),
    endDate: null,
    isCurrent: false,
  }), null);
});

test("public education entry includes optional fields only when present", () => {
  const markup = renderEducationEntry(education({
    fieldOfStudy: null,
    description: null,
    startDate: null,
    endDate: null,
  }));

  assert.match(markup, /Example Institution/u);
  assert.match(markup, /Example Program/u);
  assert.doesNotMatch(markup, /Field of study:/u);
  assert.doesNotMatch(markup, /public-education__description/u);
  assert.doesNotMatch(markup, /public-education__dates/u);
});

test("public education descriptions render as escaped React text with line breaks retained", () => {
  const description = "<script>alert('no')</script>\nSecond line with <em>plain text</em>.";
  const markup = renderEducationEntry(education({ description }));

  assert.match(markup, /&lt;script&gt;/u);
  assert.match(markup, /&lt;em&gt;plain text&lt;\/em&gt;/u);
  assert.doesNotMatch(markup, /<script>|<em>/u);
  assert.match(markup, /alert\(&#x27;no&#x27;\)&lt;\/script&gt;/u);
  assert.match(markup, /Second line with &lt;em&gt;/u);
  assert.ok(markup.includes("\nSecond line") || markup.includes("\\nSecond line"));
  assert.match(markup, /public-education__description/u);
});
