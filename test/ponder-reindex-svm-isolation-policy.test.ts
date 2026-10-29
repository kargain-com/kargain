/**
 * Retention vs projection isolation — both directions (ADR 0014 §f / #69).
 * Retention drops only ^k_[0-9a-f]{40}$; never Context §6 schemas.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  dropDeploymentSchemaSql,
  keepSetFromState,
  PROTECTED_SCHEMAS,
  retentionDropSql,
  retentionSchemasToDrop,
  retentionWouldSelect,
  type RetentionKeepSet,
} from "../scripts/lib/ponder-deploy-retention.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTION_REBUILD = path.join(ROOT, "src/svm-ingest/projection-rebuild.ts");
const PROJECTION_WRITER = path.join(ROOT, "src/lib/svm-projection-writer.ts");

const NO_KEEP: RetentionKeepSet = {
  live: null,
  previous: null,
  pending: null,
  legacy: null,
};

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
      NO_KEEP,
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
      { ...NO_KEEP, live },
    );
    assert.deepEqual(drop, [old]);
  });

  it("B6: dropDeploymentSchemaSql re-validates and refuses keep-set / non-k_*", () => {
    const old =
      "k_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const live =
      "k_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    assert.equal(
      dropDeploymentSchemaSql(old, NO_KEEP),
      `DROP SCHEMA IF EXISTS "${old}" CASCADE;`,
    );
    assert.throws(
      () => dropDeploymentSchemaSql("ponder_sync", NO_KEEP),
      /deploy_retention_refused/,
    );
    assert.throws(
      () => dropDeploymentSchemaSql(live, { ...NO_KEEP, live }),
      /deploy_retention_refused: schema in keep set/,
    );
  });

  it("R9: keep is required — a drop without the state's keep set is refused", () => {
    const old = "k_" + "a".repeat(40);
    assert.throws(
      () => dropDeploymentSchemaSql(old, undefined as unknown as RetentionKeepSet),
      TypeError,
    );
    assert.throws(
      () => retentionDropSql([old], undefined as unknown as RetentionKeepSet),
      TypeError,
    );
  });

  it("R9: the keep set an executor passes is the state file's live/previous/pending/legacy", () => {
    const refs = (c: string) => ({ schema: "k_" + c.repeat(40) });
    const keep = keepSetFromState({
      live: refs("b"),
      previous: refs("c"),
      pending: refs("d"),
      legacy_schema: "k_" + "e".repeat(40),
    });
    for (const c of ["b", "c", "d", "e"]) {
      assert.throws(
        () => dropDeploymentSchemaSql("k_" + c.repeat(40), keep),
        /schema in keep set/,
        c,
      );
    }
    assert.ok(dropDeploymentSchemaSql("k_" + "f".repeat(40), keep));
  });

  it("R12: while a first-cutover rollback is valid, legacy_schema is in the keep set (retention and drop_schema refuse it)", () => {
    const legacy = "k_" + "e".repeat(40);
    const live = "k_" + "b".repeat(40);
    const keep: RetentionKeepSet = { ...NO_KEEP, live, legacy };
    assert.deepEqual(retentionSchemasToDrop([legacy, live], keep), []);
    assert.throws(
      () => dropDeploymentSchemaSql(legacy, keep),
      /deploy_retention_refused: schema in keep set/,
    );
    // Once the switch clears legacy_schema, retention may drop it.
    assert.deepEqual(
      retentionSchemasToDrop([legacy, live], { ...keep, legacy: null }),
      [legacy],
    );
  });

  it("R9/R12: retention CLI reads the keep set from the state file at execution and requires --state", () => {
    const cli = path.join(ROOT, "scripts/ponder-deploy-retention-cli.ts");
    const legacy = "k_" + "e".repeat(40);
    const live = "k_" + "b".repeat(40);
    const old = "k_" + "a".repeat(40);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ponder-retention-"));
    const statePath = path.join(dir, "state.json");
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        identity: "id",
        executable: "ex",
        live: { slot: "blue", schema: live, commit: "b".repeat(40), executable: "ex" },
        previous: null,
        pending: null,
        rollback_model: "keep_previous",
        lag: null,
        legacy_schema: legacy,
        legacy_image: "sha256:legacy",
        nginx_config_digest: null,
      }),
    );
    const run = (...args: string[]) =>
      spawnSync("node", ["--import", "tsx", cli, ...args], {
        cwd: ROOT,
        encoding: "utf8",
      });

    const noState = run("--drop-schema", old);
    assert.equal(noState.status, 2, "missing --state must be a usage error");

    const legacyDrop = run("--state", statePath, "--drop-schema", legacy);
    assert.equal(legacyDrop.status, 1);
    assert.match(legacyDrop.stderr, /deploy_retention_refused: schema in keep set/);

    const liveDrop = run("--state", statePath, "--drop-schema", live);
    assert.equal(liveDrop.status, 1);

    const oldDrop = run("--state", statePath, "--drop-schema", old);
    assert.equal(oldDrop.status, 0, oldDrop.stderr);
    assert.match(oldDrop.stdout, /DROP SCHEMA IF EXISTS/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("projection rebuild drops projection schema only", () => {
    assertProjectionRebuildIsolation(rebuildSrc, writerSrc);
  });

  it("constructed violation: projection writer touching ponder_sync fails", () => {
    const dirty = `${writerSrc}\nDROP SCHEMA IF EXISTS ponder_sync CASCADE;`;
    assert.throws(() => assertProjectionRebuildIsolation(rebuildSrc, dirty));
  });
});
