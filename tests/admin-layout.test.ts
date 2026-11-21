import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { isAdminNavigationItemActive } from "../src/lib/admin-navigation";

const adminRoutes = [
  "page.tsx",
  "profile/page.tsx",
  "skills/page.tsx",
  "projects/page.tsx",
  "blog/page.tsx",
  "education/page.tsx",
  "experience/page.tsx",
  "messages/page.tsx",
  "settings/page.tsx",
];

test("the shared admin layout owns one navigation shell and renders the active route children", async () => {
  const layout = await readFile(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf8");
  assert.equal((layout.match(/<AdminSidebar\b/gu) ?? []).length, 1);
  assert.match(layout, /className="admin-dashboard__main"[\s\S]*?\{children\}/u);
});

test("the session-guarded admin layout allows its auth redirect to block instant UI validation", async () => {
  const layout = await readFile(new URL("../src/app/admin/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /export const instant = false/u);
  assert.match(layout, /if \(!session\)\s*\{\s*redirect\("\/admin\/login"\);/u);
});

test("admin page modules render route content without nesting shared navigation shells", async () => {
  for (const route of adminRoutes) {
    const source = await readFile(new URL(`../src/app/admin/${route}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<AdminSidebar\b|admin-dashboard__shell|admin-dashboard__main/u, route);
  }
});

test("Profile and Settings route modules keep their own forms separate", async () => {
  const profile = await readFile(
    new URL("../src/app/admin/profile/page.tsx", import.meta.url),
    "utf8",
  );
  const settings = await readFile(
    new URL("../src/app/admin/settings/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(profile, /<ProfileForm\b/u);
  assert.doesNotMatch(profile, /SettingsForm/u);
  assert.match(settings, /<SettingsForm\b/u);
  assert.doesNotMatch(settings, /ProfileForm/u);
});

test("the Messages page redirects EDITORs and the sidebar exposes its link only to ADMIN", async () => {
  const [messagesPage, sidebar] = await Promise.all([
    readFile(new URL("../src/app/admin/messages/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/admin/admin-sidebar.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(messagesPage, /if \(!session\)\s*\{\s*redirect\("\/admin\/login"\);\s*\}\s*if \(session\.user\.role !== "ADMIN"\) redirect\("\/admin"\);/u);
  assert.match(sidebar, /\{ label: "Messages", icon: Mail, href: "\/admin\/messages", adminOnly: true \}/u);
  assert.match(sidebar, /navigationItems\.filter\(\(item\) => !item\.adminOnly \|\| role === "ADMIN"\)/u);
});

test("navigation highlights the current section without conflating Profile and Settings", () => {
  assert.equal(isAdminNavigationItemActive("/admin/profile", "/admin/profile"), true);
  assert.equal(isAdminNavigationItemActive("/admin/settings", "/admin/settings"), true);
  assert.equal(isAdminNavigationItemActive("/admin/settings", "/admin/profile"), false);
  assert.equal(isAdminNavigationItemActive("/admin/profile", "/admin/settings"), false);
  assert.equal(isAdminNavigationItemActive("/admin/projects/123", "/admin/projects"), true);
  assert.equal(isAdminNavigationItemActive("/admin/profile", "/admin"), false);
});
