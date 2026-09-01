/**
 * Reindex vs projection isolation — both directions (S7c-2).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REINDEX_SQL = path.join(ROOT, "scripts/ponder-reindex.sql");
const PROJECTION_REBUILD = path.join(ROOT, "src/svm-ingest/projection-rebuild.ts");
const PROJECTION_WRITER = path.join(ROOT, "src/lib/svm-projection-writer.ts");

function assertReindexIsolation(sql: string): void {
  const upper = sql.toUpperCase();
  assert.ok(upper.includes("DROP SCHEMA IF EXISTS KARGAIN"), "must drop kargain");
  assert.ok(upper.includes("DROP SCHEMA IF EXISTS PONDER_SYNC"), "must drop ponder_sync");
  assert.ok(!sql.includes("kargain_svm_raw"), "must not reference kargain_svm_raw");
  assert.ok(!sql.includes("kargain_svm_projection"), "must not reference kargain_svm_projection");
}

function assertProjectionRebuildIsolation(rebuildSrc: string, writerSrc: string): void {
  assert.ok(rebuildSrc.includes("dropSvmProjectionSchema"));
  assert.ok(rebuildSrc.includes("rebuildProjectionFromRaw"));
  assert.ok(!rebuildSrc.includes("rpc-client"));
  assert.ok(writerSrc.includes("DROP SCHEMA IF EXISTS kargain_svm_projection"));
  assert.ok(!writerSrc.includes("DROP SCHEMA IF EXISTS kargain CASCADE"));
  assert.ok(!writerSrc.includes("ponder_sync"));
}

describe("ponder reindex svm isolation policy", () => {
  const sql = fs.readFileSync(REINDEX_SQL, "utf8");
  const rebuildSrc = fs.readFileSync(PROJECTION_REBUILD, "utf8");
  const writerSrc = fs.readFileSync(PROJECTION_WRITER, "utf8");

  it("drops kargain and ponder_sync only", () => {
    assertReindexIsolation(sql);
  });

  it("constructed violation: dropping svm projection in reindex fails", () => {
    const dirty = `${sql}\nDROP SCHEMA IF EXISTS kargain_svm_projection CASCADE;`;
    assert.throws(() => assertReindexIsolation(dirty), /kargain_svm_projection/);
  });

  it("projection rebuild drops projection schema only", () => {
    assertProjectionRebuildIsolation(rebuildSrc, writerSrc);
  });

  it("constructed violation: projection writer touching ponder_sync fails", () => {
    const dirty = `${writerSrc}\nDROP SCHEMA IF EXISTS ponder_sync CASCADE;`;
    assert.throws(() => assertProjectionRebuildIsolation(rebuildSrc, dirty));
  });
});
