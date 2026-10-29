import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEPLOY_STATE_INVALID,
  parseKargainObservationRow,
  parsePonderDeployStateFile,
  readPonderDeployStateFile,
  reconcileDeployPhase,
  schemaNameForDeploySha,
  type KargainObservation,
} from "../scripts/lib/ponder-deploy-state.ts";
import {
  decideRollbackModel,
  type LagSample,
} from "../scripts/lib/ponder-rollback-decision.ts";

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

const BASE_TABLES: KargainObservation = {
  kargainHasBaseTables: true,
  kargainViewsTarget: null,
};

function viewsOver(schema: string): KargainObservation {
  return { kargainHasBaseTables: false, kargainViewsTarget: schema };
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
    const s = reconcileDeployPhase(file, BASE_TABLES);
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
    const s = reconcileDeployPhase(file, viewsOver(schemaA));
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
          BASE_TABLES,
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
          viewsOver(schemaA),
        ),
      /phase_mismatch/,
    );
  });

  const firstCutoverFile = () =>
    parsePonderDeployStateFile({
      ...fingerprintsOnly(),
      live: null,
      previous: null,
      pending: slot("blue", schemaB, shaB, execB),
      rollback_model: "keep_previous",
      lag: null,
      legacy_schema: schemaA,
      legacy_image: "sha256:legacy",
      nginx_config_digest: null,
    });

  it("R1: post-cutover, live null, views target = pending.schema → interrupted first cutover (not phase_mismatch)", () => {
    const s = reconcileDeployPhase(firstCutoverFile(), viewsOver(schemaB));
    assert.equal(s.phase, "first_cutover_interrupted");
    assert.equal(s.live, null);
    assert.equal(s.pending?.schema, schemaB);
  });

  it("R1: every other disagreement stays deploy_state_invalid", () => {
    // live null, views target is neither pending nor anything recorded
    assert.throws(
      () => reconcileDeployPhase(firstCutoverFile(), viewsOver(schemaC)),
      /deploy_state_invalid: phase_mismatch/,
    );
    // live null, no pending at all
    assert.throws(
      () =>
        reconcileDeployPhase(
          parsePonderDeployStateFile(fingerprintsOnly()),
          viewsOver(schemaB),
        ),
      /deploy_state_invalid: phase_mismatch/,
    );
    // neither base tables nor views
    assert.throws(
      () =>
        reconcileDeployPhase(firstCutoverFile(), {
          kargainHasBaseTables: false,
          kargainViewsTarget: null,
        }),
      /neither base tables nor views/,
    );
    // live set but the views read a third schema
    const live = parsePonderDeployStateFile({
      ...fingerprintsOnly(),
      live: slot("blue", schemaA, shaA, execA),
      previous: null,
      pending: null,
      rollback_model: "keep_previous",
      lag: null,
      legacy_schema: null,
      legacy_image: null,
      nginx_config_digest: null,
    });
    assert.throws(
      () => reconcileDeployPhase(live, viewsOver(schemaC)),
      /deploy_state_invalid: phase_mismatch: kargain views read/,
    );
    // base tables present while live is set
    assert.throws(
      () => reconcileDeployPhase(live, BASE_TABLES),
      /phase_mismatch/,
    );
  });

  it("R1: an interrupted normal switch (views already read pending) is post_cutover", () => {
    const file = parsePonderDeployStateFile({
      ...fingerprintsOnly(),
      live: slot("blue", schemaA, shaA, execA),
      previous: null,
      pending: slot("green", schemaB, shaB, execB),
      rollback_model: "keep_previous",
      lag: null,
      legacy_schema: null,
      legacy_image: null,
      nginx_config_digest: null,
    });
    assert.equal(reconcileDeployPhase(file, viewsOver(schemaB)).phase, "post_cutover");
    assert.equal(reconcileDeployPhase(file, viewsOver(schemaA)).phase, "post_cutover");
  });

  it("R1: kargain observation row parses base tables and the one views target; mixed targets refuse", () => {
    assert.deepEqual(parseKargainObservationRow("t|0|"), BASE_TABLES);
    assert.deepEqual(parseKargainObservationRow(`f|1|${schemaB}`), viewsOver(schemaB));
    assert.throws(
      () => parseKargainObservationRow(`f|2|${schemaA}`),
      /deploy_observation_failed: kargain_views_target/,
    );
    assert.throws(
      () => parseKargainObservationRow("f|1|not_a_deployment_schema"),
      /deploy_observation_failed: kargain_views_target/,
    );
    assert.throws(
      () => parseKargainObservationRow("garbage"),
      /deploy_observation_failed: kargain_observation/,
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

  it("R18: the deprecated field-absence inference is deleted", () => {
    const src = fs.readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../scripts/lib/ponder-deploy-state.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(src, /parsePonderDeployState\b(?!File)/);
    assert.doesNotMatch(src, /@deprecated/);
    assert.doesNotMatch(src, /\binferred\b/);
  });
});

describe("ponder-rollback-decision (R10)", () => {
  const T0 = Date.parse("2026-10-29T10:00:00Z");
  const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
  const series = (chainId: number, lag: number, minutes = [0, 15, 30]): LagSample[] =>
    minutes.map((m) => ({ chainId, lag_seconds: lag, at: at(m) }));
  const BASE = 84532;
  const ETH = 11155111;
  const both = [BASE, ETH];

  it("both expected chains with ≥3 samples over ≥30 min decide keep_previous / restart_previous", () => {
    const baseline = [...series(BASE, 1), ...series(ETH, 2)];
    const ok = decideRollbackModel(baseline, [...series(BASE, 5), ...series(ETH, 5)], both);
    assert.equal(ok.rollback_model, "keep_previous");
    assert.equal(ok.l_single_max, 2);
    assert.equal(ok.m, 30);
    assert.equal(ok.b, 32);
    const bad = decideRollbackModel(baseline, [...series(BASE, 5), ...series(ETH, 500)], both);
    assert.equal(bad.rollback_model, "restart_previous");
  });

  it("constructed: a file holding only one chain is a refusal (missing chain)", () => {
    const baseline = [...series(BASE, 1), ...series(ETH, 1)];
    assert.throws(
      () => decideRollbackModel(baseline, series(BASE, 5), both),
      /decide_rollback_model_refused: dual missing chain 11155111/,
    );
    assert.throws(
      () => decideRollbackModel(series(ETH, 1), [...series(BASE, 5), ...series(ETH, 5)], both),
      /decide_rollback_model_refused: baseline missing chain 84532/,
    );
  });

  it("constructed: an extra chain is a refusal", () => {
    const baseline = [...series(BASE, 1), ...series(ETH, 1), ...series(31337, 1)];
    assert.throws(
      () => decideRollbackModel(baseline, [...series(BASE, 5), ...series(ETH, 5)], both),
      /decide_rollback_model_refused: baseline extra chain 31337/,
    );
  });

  it("window rules: <3 samples or <30 min span per expected chain refuse", () => {
    const full = [...series(BASE, 1), ...series(ETH, 1)];
    assert.throws(
      () =>
        decideRollbackModel(full, [...series(BASE, 5, [0, 30]), ...series(ETH, 5)], both),
      /needs ≥3 samples for chain 84532, got 2/,
    );
    assert.throws(
      () =>
        decideRollbackModel(full, [...series(BASE, 5), ...series(ETH, 5, [0, 5, 10])], both),
      /chain 11155111 span .* < 30m/,
    );
  });

  it("an empty expected chain set refuses (never green over an empty set)", () => {
    assert.throws(
      () => decideRollbackModel(series(BASE, 1), series(BASE, 1), []),
      /expected chain set is empty/,
    );
  });
});
