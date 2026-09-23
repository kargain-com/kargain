/**
 * 6d-2 measure harness names H1–H4 and isolation A/B/C.
 * Pins the owner file — does not run LiteSVM or a validator.
 * Plants are in-memory only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const HARNESS_REL = "svm/lab/scripts/measure-6d2.ts";

export const MEASURE_6D2_HYPOTHESES = ["H1", "H2", "H3", "H4"] as const;
export const MEASURE_6D2_ISOLATION = ["A", "B", "C"] as const;

export type Measure6d2Facts = {
  hypotheses: string[];
  isolationPaths: string[];
  namesLiteSvmLiveGate: boolean;
  namesValidatorLiveGate: boolean;
};

function registryHasHypothesis(source: string, id: string): boolean {
  const m = source.match(
    /export const MEASURE_6D2_HYPOTHESES\s*=\s*\[([\s\S]*?)\]\s+as const/,
  );
  return m ? new RegExp(`["']${id}["']`).test(m[1]!) : false;
}

function registryHasIsolation(source: string, id: string): boolean {
  const m = source.match(
    /export const MEASURE_6D2_ISOLATION\s*=\s*\[([\s\S]*?)\]\s+as const/,
  );
  return m ? new RegExp(`["']${id}["']`).test(m[1]!) : false;
}

function hypothesisPresent(source: string, id: string): boolean {
  const runner = new RegExp(`(?:async )?function run${id}\\b`).test(source);
  return registryHasHypothesis(source, id) && runner;
}

function isolationPresent(source: string, id: string): boolean {
  const runner = new RegExp(`runIsolation${id}\\b`).test(source);
  const constId = new RegExp(`const ISOLATION_${id}\\b`).test(source);
  return registryHasIsolation(source, id) && runner && constId;
}

/**
 * Extract 6d-2 harness facts from source text — never a line-number citation.
 */
export function extractMeasure6d2Facts(source: string): Measure6d2Facts {
  return {
    hypotheses: MEASURE_6D2_HYPOTHESES.filter((id) => hypothesisPresent(source, id)),
    isolationPaths: MEASURE_6D2_ISOLATION.filter((id) => isolationPresent(source, id)),
    namesLiteSvmLiveGate: /(?:test:ci|test:verify).{0,80}measure:6d2|measure:6d2.{0,80}(?:test:ci|test:verify)/.test(
      source.replace(/not wired into test:ci \/ test:verify \/ stand/g, ""),
    ),
    namesValidatorLiveGate: /run-stand\.sh --live/.test(source) && /must run stand/.test(source),
  };
}

describe("svm-6d2-measure-policy", () => {
  const live = readFileSync(join(ROOT, HARNESS_REL), "utf8");

  it("live harness names H1–H4 and isolation A/B/C both directions", () => {
    const facts = extractMeasure6d2Facts(live);
    assert.deepEqual(facts.hypotheses, [...MEASURE_6D2_HYPOTHESES]);
    assert.deepEqual(facts.isolationPaths, [...MEASURE_6D2_ISOLATION]);
    for (const id of MEASURE_6D2_HYPOTHESES) {
      assert.equal(hypothesisPresent(live, id), true, `missing hypothesis ${id}`);
    }
    for (const id of MEASURE_6D2_ISOLATION) {
      assert.equal(isolationPresent(live, id), true, `missing isolation ${id}`);
    }
    assert.equal(facts.hypotheses.length, 4);
    assert.equal(facts.isolationPaths.length, 3);
  });

  it("planted missing H3 or path A is red then green (in-memory)", () => {
    const dropH3 = live.replace(
      /export const MEASURE_6D2_HYPOTHESES = \["H1", "H2", "H3", "H4"\] as const/,
      'export const MEASURE_6D2_HYPOTHESES = ["H1", "H2", "H4"] as const',
    );
    const dropA = live.replace(
      /export const MEASURE_6D2_ISOLATION = \["A", "B", "C"\] as const/,
      'export const MEASURE_6D2_ISOLATION = ["B", "C"] as const',
    );
    const redH3 = extractMeasure6d2Facts(dropH3);
    const redA = extractMeasure6d2Facts(dropA);
    assert.equal(redH3.hypotheses.includes("H3"), false);
    assert.equal(redA.isolationPaths.includes("A"), false);
    const green = extractMeasure6d2Facts(live);
    assert.deepEqual(green.hypotheses, [...MEASURE_6D2_HYPOTHESES]);
    assert.deepEqual(green.isolationPaths, [...MEASURE_6D2_ISOLATION]);
  });

  it("does not join a live LiteSVM or validator gate", () => {
    const facts = extractMeasure6d2Facts(live);
    assert.equal(facts.namesLiteSvmLiveGate, false);
    assert.equal(facts.namesValidatorLiveGate, false);
    assert.match(live, /not wired into test:ci/);
    assert.match(live, /ISOLATION_A/);
    assert.match(live, /ISOLATION_B/);
    assert.match(live, /ISOLATION_C/);
  });
});
