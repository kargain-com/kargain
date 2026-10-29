/**
 * Retention vs projection isolation — both directions (ADR 0014 §f / #69).
 * Retention drops only ^k_[0-9a-f]{40}$; never Context §6 schemas.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  dropDeploymentSchemaSql,
  PROTECTED_SCHEMAS,
  retentionSchemasToDrop,
  retentionWouldSelect,
} from "../scripts/lib/ponder-deploy-retention.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

describe("ponder retention svm isolation policy", () => {
  const rebuildSrc = fs.readFileSync(PROJECTION_REBUILD, "utf8");
  const writerSrc = fs.readFileSync(PROJECTION_WRITER, "utf8");

  it("retention regex never selects Context §6 schemas", () => {
    for (const name of PROTECTED_SCHEMAS) {
      assert.equal(
        retentionWouldSelect(name),
        false,
        `must not select ${name}`,
      );
    }
    assert.equal(retentionWouldSelect("ponder_sync"), false);
    assert.equal(retentionWouldSelect("kargain_svm_raw"), false);
  });

  it("constructed: retention fed ponder_sync or kargain_svm_raw never selects them", () => {
    const drop = retentionSchemasToDrop(
      ["ponder_sync", "kargain_svm_raw", "kargain", "ponder_rpc_cache_1"],
      { live: null, previous: null, pending: null },
    );
    assert.deepEqual(drop, []);
  });

  it("drops older k_* schemas not in the keep set", () => {
    const old =
      "k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const live =
      "k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const drop = retentionSchemasToDrop(
      [old, live, "ponder_sync", "kargain_svm_raw"],
      { live, previous: null, pending: null },
    );
    assert.deepEqual(drop, [old]);
  });

  it("B6: dropDeploymentSchemaSql re-validates and refuses keep-set / non-k_*", () => {
    const old =
      "k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const live =
      "k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.equal(
      dropDeploymentSchemaSql(old),
      `DROP SCHEMA IF EXISTS "${old}" CASCADE;`,
    );
    assert.throws(
      () => dropDeploymentSchemaSql("ponder_sync"),
      /deploy_retention_refused/,
    );
    assert.throws(
      () =>
        dropDeploymentSchemaSql(live, {
          live,
          previous: null,
          pending: null,
        }),
      /deploy_retention_refused: schema in keep set/,
    );
  });

  it("constructed violation: selecting ponder_sync fails the wouldSelect control", () => {
    assert.equal(retentionWouldSelect("ponder_sync"), false);
    assert.throws(() => {
      assert.equal(retentionWouldSelect("ponder_sync"), true);
    }, /ponder_sync|Expected/);
  });

  it("projection rebuild drops projection schema only", () => {
    assertProjectionRebuildIsolation(rebuildSrc, writerSrc);
  });

  it("constructed violation: projection writer touching ponder_sync fails", () => {
    const dirty = `${writerSrc}\nDROP SCHEMA IF EXISTS ponder_sync CASCADE;`;
    assert.throws(() => assertProjectionRebuildIsolation(rebuildSrc, dirty));
  });
});
