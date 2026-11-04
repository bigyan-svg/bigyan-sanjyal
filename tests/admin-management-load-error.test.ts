import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Projects and Blog render their manager only after all required data loads", async () => {
  const projectsPage = await readFile(new URL("../src/app/admin/projects/page.tsx", import.meta.url), "utf8");
  const blogPage = await readFile(new URL("../src/app/admin/blog/page.tsx", import.meta.url), "utf8");

  assert.match(projectsPage, /Promise\.all\(\[[\s\S]*?prisma\.project\.findMany[\s\S]*?prisma\.projectCategory\.findMany[\s\S]*?prisma\.skill\.findMany/u);
  assert.match(projectsPage, /<AdminDataLoadError[\s\S]*?\/>[\s\S]*?<ProjectsManager/u);
  assert.match(blogPage, /Promise\.all\(\[[\s\S]*?prisma\.post\.findMany[\s\S]*?prisma\.postCategory\.findMany[\s\S]*?prisma\.tag\.findMany/u);
  assert.match(blogPage, /<AdminDataLoadError[\s\S]*?\/>[\s\S]*?<BlogManager/u);
});

test("admin load error exposes a guarded router-refresh retry", async () => {
  const component = await readFile(new URL("../src/components/admin/admin-data-load-error.tsx", import.meta.url), "utf8");

  assert.match(component, /router\.refresh\(\)/u);
  assert.match(component, /retryStartedRef\.current \|\| isPending/u);
  assert.match(component, /disabled=\{isPending\}/u);
  assert.match(component, /aria-busy=\{isPending\}/u);
  assert.match(component, /role="alert"/u);
});
