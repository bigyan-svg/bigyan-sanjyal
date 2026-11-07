import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPreviewAdminConfirmation,
  getPreviewAdminTarget,
  PREVIEW_ADMIN_DATABASE,
  PREVIEW_ADMIN_HOST,
  PREVIEW_ADMIN_POOLER_HOST,
  PreviewAdminTargetError,
} from "../src/lib/admin-preview-target";

function previewUrl(overrides: { host?: string; database?: string } = {}): string {
  const host = overrides.host ?? PREVIEW_ADMIN_HOST;
  const database = overrides.database ?? PREVIEW_ADMIN_DATABASE;
  return `postgresql://preview-user:preview-password@${host}:5432/${database}?sslmode=require`;
}

test("accepts the exact verified Preview hostname and database", () => {
  const target = getPreviewAdminTarget(previewUrl());
  assert.equal(target?.display, `${PREVIEW_ADMIN_HOST}:5432/neondb`);
  assert.equal(
    target?.confirmation,
    `PROVISION PREVIEW ADMIN ${PREVIEW_ADMIN_HOST}:5432/neondb`,
  );
});

test("accepts only the exact verified direct and pooled hostnames", () => {
  const direct = getPreviewAdminTarget(previewUrl());
  const pooled = getPreviewAdminTarget(
    previewUrl({ host: PREVIEW_ADMIN_POOLER_HOST }),
  );
  assert.equal(direct?.display, `${PREVIEW_ADMIN_HOST}:5432/neondb`);
  assert.equal(pooled?.display, `${PREVIEW_ADMIN_POOLER_HOST}:5432/neondb`);
  assert.equal(
    getPreviewAdminTarget(
      previewUrl({ host: `${PREVIEW_ADMIN_HOST}-pooler.example.test` }),
    ),
    null,
  );
});

test("rejects production and unknown hosts", () => {
  assert.equal(getPreviewAdminTarget(previewUrl({ host: "production.neon.tech" })), null);
  assert.equal(getPreviewAdminTarget(previewUrl({ host: "unknown.example.test" })), null);
});

test("rejects wrong database and malformed or missing URLs", () => {
  assert.equal(getPreviewAdminTarget(previewUrl({ database: "postgres" })), null);
  assert.equal(getPreviewAdminTarget(undefined), null);
  assert.equal(getPreviewAdminTarget("not-a-database-url"), null);
});

test("rejects unexpected port and host override parameters", () => {
  assert.equal(
    getPreviewAdminTarget(previewUrl().replace(":5432/", ":5433/")),
    null,
  );
  assert.equal(
    getPreviewAdminTarget(`${previewUrl()}&host=production.neon.tech`),
    null,
  );
});

test("rejects incorrect typed confirmation", () => {
  const target = getPreviewAdminTarget(previewUrl());
  assert.ok(target);
  assert.throws(
    () => assertPreviewAdminConfirmation("PROVISION PREVIEW ADMIN wrong", target),
    PreviewAdminTargetError,
  );
});

test("Preview target and errors never retain URL credentials in output", () => {
  const url = previewUrl();
  const target = getPreviewAdminTarget(url);
  assert.ok(target);
  assert.equal(JSON.stringify(target).includes("preview-password"), false);
  assert.equal(JSON.stringify(target).includes("preview-user"), false);
});
