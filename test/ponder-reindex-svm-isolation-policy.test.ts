/**
 * Reindex vs projection isolation — both directions (S7c-2 / ADR 0015).
 * ADR 0015 removes scripts/ponder-reindex.sh|.sql; retention never selects
 * protected schemas. Projection rebuild still drops only the projection schema.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_SCHEMAS,
  retentionWouldSelect,
} from "../scripts/lib/ponder-deploy-retention.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REINDEX_SQL = path.join(ROOT, "scripts/ponder-reindex.sql");
const REINDEX_SH = path.join(ROOT, "scripts/ponder-reindex.sh");
const PROJECTION_REBUILD = path.join(ROOT, "src/svm-ingest/projection-rebuild.ts");
const PROJECTION_WRITER = path.join(ROOT, "src/lib/svm-projection-writer.ts");

function assertProjectionRebuildIsolation(rebuildSrc: string, writerSrc: string): void {
  assert.ok(rebuildSrc.includes("dropSvmProjectionSchema"));
  assert.ok(rebuildSrc.includes("rebuildProjectionFromRaw"));
  assert.ok(!rebuildSrc.includes("rpc-client"));
  assert.ok(writerSrc.includes("DROP SCHEMA IF EXISTS kargain_svm_projection"));
  assert.ok(!writerSrc.includes("DROP SCHEMA IF EXISTS kargain CASCADE"));
  assert.ok(!writerSrc.includes("ponder_sync"));
}

describe("ponder reindex svm isolation policy", () => {
  const rebuildSrc = fs.readFileSync(PROJECTION_REBUILD, "utf8");
  const writerSrc = fs.readFileSync(PROJECTION_WRITER, "utf8");

  it("ADR 0015: ponder-reindex.sh and .sql are removed", () => {
    assert.equal(fs.existsSync(REINDEX_SQL), false);
    assert.equal(fs.existsSync(REINDEX_SH), false);
  });

  it("retention never selects protected schemas", () => {
    for (const name of PROTECTED_SCHEMAS) {
      assert.equal(retentionWouldSelect(name), false, name);
    }
  });

  it("constructed violation: retentionWouldSelect on ponder_sync stays red", () => {
    assert.equal(retentionWouldSelect("ponder_sync"), false);
  });

  it("projection rebuild drops projection schema only", () => {
    assertProjectionRebuildIsolation(rebuildSrc, writerSrc);
  });

  it("constructed violation: projection writer touching ponder_sync fails", () => {
    const dirty = `${writerSrc}\nDROP SCHEMA IF EXISTS ponder_sync CASCADE;`;
    assert.throws(() => assertProjectionRebuildIsolation(rebuildSrc, dirty));
  });
});
