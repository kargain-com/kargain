import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_STATE_INVALID,
  parsePonderDeployStateFile,
  readPonderDeployStateFile,
  reconcileDeployPhase,
  schemaNameForDeploySha,
} from "../scripts/lib/ponder-deploy-state.ts";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const shaC = "c".repeat(40);
const schemaA = `k_${shaA}`;
const schemaB = `k_${shaB}`;
const schemaC = `k_${shaC}`;
const execA = "execA";
const execB = "execB";

function slot(
  color: "blue" | "green",
  schema: string,
  commit: string,
  executable: string,
) {
  return { slot: color, schema, commit, executable };
}

function fingerprintsOnly() {
  return {
    identity: "id".repeat(32),
    executable: "ex".repeat(32),
  };
}

describe("ponder-deploy-state", () => {
  it("A1: reconcileDeployPhase maps base tables → pre_cutover when live is null", () => {
    const file = parsePonderDeployStateFile(fingerprintsOnly());
    const s = reconcileDeployPhase(file, true);
    assert.equal(s.phase, "pre_cutover");
    assert.equal(s.live, null);
  });

  it("A1: reconcileDeployPhase maps views-only → post_cutover when live is set", () => {
    const file = parsePonderDeployStateFile({
      ...fingerprintsOnly(),
      live: slot("blue", schemaA, shaA, execA),
      previous: null,
      pending: null,
      rollback_model: "keep_previous",
      lag: null,
      legacy_schema: schemaA,
      legacy_image: null,
      nginx_config_digest: null,
    });
    const s = reconcileDeployPhase(file, false);
    assert.equal(s.phase, "post_cutover");
    assert.equal(s.live?.schema, schemaA);
  });

  it("A1 constructed: live set with base tables → phase_mismatch", () => {
    assert.throws(
      () =>
        reconcileDeployPhase(
          {
            ...fingerprintsOnly(),
            live: slot("blue", schemaA, shaA, execA),
            previous: null,
            pending: null,
            rollback_model: null,
            lag: null,
            legacy_schema: null,
            legacy_image: null,
            nginx_config_digest: null,
          },
          true,
        ),
      /phase_mismatch/,
    );
  });

  it("A1 constructed: live null with no base tables → phase_mismatch", () => {
    assert.throws(
      () =>
        reconcileDeployPhase(
          {
            ...fingerprintsOnly(),
            live: null,
            previous: null,
            pending: null,
            rollback_model: null,
            lag: null,
            legacy_schema: null,
            legacy_image: null,
            nginx_config_digest: null,
          },
          false,
        ),
      /phase_mismatch/,
    );
  });

  it("A2: missing file → deploy_state_invalid (never invent)", () => {
    const missing = path.join(
      os.tmpdir(),
      `ponder-deploy-state-missing-${process.pid}-${Date.now()}.json`,
    );
    assert.throws(
      () => readPonderDeployStateFile(missing),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(DEPLOY_STATE_INVALID) &&
        err.message.includes("cannot read"),
    );
  });

  it("constructed: unknown field → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          extra: true,
        }),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(DEPLOY_STATE_INVALID) &&
        err.message.includes("unknown field"),
    );
  });

  it("constructed: slot ref missing commit → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: { slot: "blue", schema: schemaA, executable: execA },
        }),
      /deploy_state_invalid/,
    );
  });

  it("constructed: slot ref missing executable → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: { slot: "blue", schema: schemaA, commit: shaA },
        }),
      /deploy_state_invalid/,
    );
  });

  it("constructed: slot ref with empty executable → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: {
            slot: "blue",
            schema: schemaA,
            commit: shaA,
            executable: "",
          },
        }),
      /deploy_state_invalid/,
    );
  });

  it("B5: duplicate slots across live/previous/pending → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: slot("blue", schemaA, shaA, execA),
          previous: slot("blue", schemaB, shaB, execB),
          pending: null,
          rollback_model: "keep_previous",
          lag: null,
          legacy_schema: null,
          legacy_image: null,
          nginx_config_digest: null,
        }),
      /slots must be distinct/,
    );
  });

  it("B5: duplicate schemas across live/previous/pending → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: slot("blue", schemaA, shaA, execA),
          previous: slot("green", schemaA, shaB, execB),
          pending: null,
          rollback_model: "keep_previous",
          lag: null,
          legacy_schema: null,
          legacy_image: null,
          nginx_config_digest: null,
        }),
      /schemas must be distinct/,
    );
  });

  it("B5 constructed: live+previous+pending with a reused slot is red", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: slot("blue", schemaA, shaA, execA),
          previous: slot("green", schemaB, shaB, execB),
          pending: slot("blue", schemaC, shaC, "execC"),
          rollback_model: "keep_previous",
          lag: null,
          legacy_schema: null,
          legacy_image: null,
          nginx_config_digest: null,
        }),
      /slots must be distinct/,
    );
  });

  it("B5: live + pending on distinct slots/schemas is valid", () => {
    const file = parsePonderDeployStateFile({
      ...fingerprintsOnly(),
      live: slot("blue", schemaA, shaA, execA),
      previous: null,
      pending: slot("green", schemaC, shaC, "execC"),
      rollback_model: "keep_previous",
      lag: null,
      legacy_schema: null,
      legacy_image: null,
      nginx_config_digest: null,
    });
    assert.equal(file.live?.slot, "blue");
    assert.equal(file.pending?.slot, "green");
  });

  it("constructed: bad rollback_model → deploy_state_invalid", () => {
    assert.throws(
      () =>
        parsePonderDeployStateFile({
          ...fingerprintsOnly(),
          live: slot("blue", schemaA, shaA, execA),
          previous: null,
          pending: null,
          rollback_model: "nope",
          lag: null,
          legacy_schema: null,
        }),
      /deploy_state_invalid/,
    );
  });

  it("schemaNameForDeploySha formats k_<40-hex>", () => {
    assert.equal(schemaNameForDeploySha(shaC), schemaC);
  });

  it("owner source has no assertSchema helper (deleted)", () => {
    const src = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../scripts/lib/ponder-deploy-state.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(src, /\bassertSchema\b/);
  });
});
