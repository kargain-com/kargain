/**
 * Policy: ponder-reindex.sql drops only Ponder schemas — never SVM raw/projection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SQL_PATH = path.join(ROOT, "scripts/ponder-reindex.sql");

function assertReindexIsolation(sql: string): void {
  const upper = sql.toUpperCase();
  assert.ok(upper.includes("DROP SCHEMA IF EXISTS KARGAIN"), "must drop kargain");
  assert.ok(upper.includes("DROP SCHEMA IF EXISTS PONDER_SYNC"), "must drop ponder_sync");
  assert.ok(!sql.includes("kargain_svm_raw"), "must not reference kargain_svm_raw");
  assert.ok(!sql.includes("kargain_svm_projection"), "must not reference kargain_svm_projection");
}

describe("ponder reindex svm isolation policy", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");

  it("drops kargain and ponder_sync only", () => {
    assertReindexIsolation(sql);
  });

  it("constructed violation: dropping svm raw fails", () => {
    const dirty = `${sql}\nDROP SCHEMA IF EXISTS kargain_svm_raw CASCADE;`;
    assert.throws(() => assertReindexIsolation(dirty), /kargain_svm_raw/);
  });

  it("constructed violation: omitting kargain drop fails", () => {
    const dirty = sql.replace(/DROP SCHEMA IF EXISTS kargain CASCADE;/i, "");
    assert.throws(() => assertReindexIsolation(dirty), /must drop kargain/);
  });

  it("constructed violation: omitting ponder_sync drop fails", () => {
    const dirty = sql.replace(/DROP SCHEMA IF EXISTS ponder_sync CASCADE;/i, "");
    assert.throws(() => assertReindexIsolation(dirty), /must drop ponder_sync/);
  });
});
