import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expectedVersionEntityTag,
  MAX_DATABASE_INT,
  parseExpectedVersion,
} from "../src/lib/optimistic-version";

test("version entity tags are strong quoted positive integer tokens", () => {
  assert.equal(expectedVersionEntityTag(1), '"1"');
  assert.equal(parseExpectedVersion('"1"'), 1);
  assert.equal(parseExpectedVersion(`"${MAX_DATABASE_INT}"`), MAX_DATABASE_INT);

  for (const token of [null, "", "1", '"0"', '"-1"', '"1.0"', '"01"', 'W/"1"', '"2147483648"', '"1", "2"']) {
    assert.equal(parseExpectedVersion(token), null, `expected ${String(token)} to be rejected`);
  }
});
