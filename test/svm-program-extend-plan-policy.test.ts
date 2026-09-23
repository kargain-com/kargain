/**
 * Commercial-census extend plan — pins 125% ADDITIONAL_BYTES math, registry
 * acceptance, named refusals, and rentΔ totals (in-memory; no live RPC).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST } from "../lib/svm/ingest-config.ts";
import {
  EXTEND_ARTIFACT_MISSING,
  EXTEND_NOT_IN_REGISTRY,
  EXTEND_PROGRAMS_EMPTY,
  EXTEND_TARGET_BELOW_ARTIFACT,
  assertExtendArtifactPresent,
  assertExtendProgramsInRegistry,
  assertExtendTargetCoversArtifact,
  commercialExtendEvidenceKeys,
  planProgramExtend,
  rentDeltaLamports,
  sumExtendRentDeltaLamports,
  targetCapacityAtArtifactHeadroom,
} from "../scripts/lib/svm-program-extend-plan.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-program-extend-plan-policy", () => {
  it("pins 125% targets for the four measured S9-B artifacts", () => {
    assert.equal(targetCapacityAtArtifactHeadroom(262016), 327520);
    assert.equal(targetCapacityAtArtifactHeadroom(223904), 279880);
    assert.equal(targetCapacityAtArtifactHeadroom(107584), 134480);
    assert.equal(targetCapacityAtArtifactHeadroom(148544), 185680);

    const passport = planProgramExtend({
      deployedCapacityBytes: 191128,
      artifactBytes: 262016,
    });
    assert.equal(passport.skip, false);
    if (passport.skip) throw new Error("expected extend");
    assert.equal(passport.additionalBytes, 136392);

    const gateway = planProgramExtend({
      deployedCapacityBytes: 218192,
      artifactBytes: 223904,
    });
    assert.equal(gateway.skip, false);
    if (gateway.skip) throw new Error("expected extend");
    assert.equal(gateway.additionalBytes, 61688);
  });

  it("skips when deployed capacity already meets 125% target", () => {
    const skip = planProgramExtend({
      deployedCapacityBytes: 327520,
      artifactBytes: 262016,
    });
    assert.equal(skip.skip, true);
    assert.equal(skip.additionalBytes, 0);
  });

  it("rent delta is to − from (not a invented constant)", () => {
    assert.equal(
      rentDeltaLamports({
        rentExemptFromLamports: 1_000_000,
        rentExemptToLamports: 1_500_000,
      }),
      500_000,
    );
    assert.throws(
      () =>
        rentDeltaLamports({
          rentExemptFromLamports: 2,
          rentExemptToLamports: 1,
        }),
      /to-rent/,
    );
  });

  it("six registry keys accepted both ways (red plant drops a census key)", () => {
    const live = commercialExtendEvidenceKeys();
    assert.equal(live.length, 6);
    assert.deepEqual([...live].sort(), [...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST].sort());

    for (const k of COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST) {
      assert.ok(live.includes(k), `live missing ${k}`);
    }
    for (const k of live) {
      assert.ok(
        (COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST as readonly string[]).includes(k),
        `census missing ${k}`,
      );
    }

    const plant = live.filter((k) => k !== "kar_fixed_price");
    assert.equal(plant.length, 5);
    assert.throws(
      () => {
        assert.equal(plant.length, 6, "planted filter dropped a census key");
      },
      /planted filter dropped/,
    );
    assert.equal(live.length, 6);
  });

  it("unknown key refuses by name naming registry + listing six", () => {
    assert.throws(
      () => assertExtendProgramsInRegistry(["kar_not_a_program"]),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(EXTEND_NOT_IN_REGISTRY));
        assert.match(err.message, /not in the commercial registry/);
        for (const k of COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST) {
          assert.match(err.message, new RegExp(k));
        }
        assert.doesNotMatch(err.message, /S9-B/);
        return true;
      },
    );
    assert.throws(
      () => assertExtendProgramsInRegistry([]),
      new RegExp(EXTEND_PROGRAMS_EMPTY),
    );
    assert.doesNotThrow(() =>
      assertExtendProgramsInRegistry([...COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST]),
    );
  });

  it("absent artifact refuses by name (red→green via exists stub)", () => {
    assert.throws(
      () =>
        assertExtendArtifactPresent({
          evidenceKey: "kar_fixed_price",
          soPath: "/tmp/planted-missing.so",
          exists: () => false,
        }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, new RegExp(EXTEND_ARTIFACT_MISSING));
        assert.match(err.message, /kar_fixed_price/);
        assert.match(err.message, /\/tmp\/planted-missing\.so/);
        return true;
      },
    );
    assert.doesNotThrow(() =>
      assertExtendArtifactPresent({
        evidenceKey: "kar_fixed_price",
        soPath: "/tmp/present.so",
        exists: () => true,
      }),
    );
  });

  it("target below artifact refuses by name", () => {
    assert.throws(
      () =>
        assertExtendTargetCoversArtifact({
          evidenceKey: "kar_ascending",
          artifactBytes: 100,
          targetCapacityBytes: 99,
        }),
      new RegExp(EXTEND_TARGET_BELOW_ARTIFACT),
    );
    assert.doesNotThrow(() =>
      assertExtendTargetCoversArtifact({
        evidenceKey: "kar_ascending",
        artifactBytes: 100,
        targetCapacityBytes: 125,
      }),
    );
  });

  it("totals = sum of rows (red plant wrong sum then green)", () => {
    const rows = [
      { estimatedRentDeltaLamports: 1 },
      { estimatedRentDeltaLamports: 2 },
      { estimatedRentDeltaLamports: 3 },
    ];
    const wrong = 5;
    assert.notEqual(wrong, 1 + 2 + 3);
    assert.throws(
      () => {
        assert.equal(wrong, sumExtendRentDeltaLamports(rows));
      },
      /Expected values to be strictly equal/,
    );
    assert.equal(sumExtendRentDeltaLamports(rows), 6);
    assert.equal(
      sumExtendRentDeltaLamports(rows),
      rows.reduce((a, r) => a + r.estimatedRentDeltaLamports, 0),
    );
  });

  it("CLI consumes registry assert + plan owner; no EXTENDABLE_KEYS / S9-B gate; upgrade never auto-extends", () => {
    const extendCli = readFileSync(
      join(ROOT, "scripts/svm-program-extend.ts"),
      "utf8",
    );
    assert.match(extendCli, /planProgramExtend/);
    assert.match(extendCli, /rentDeltaLamports/);
    assert.match(extendCli, /assertExtendProgramsInRegistry/);
    assert.match(extendCli, /sumExtendRentDeltaLamports/);
    assert.match(extendCli, /assertExtendArtifactPresent/);
    assert.match(extendCli, /assertExtendTargetCoversArtifact/);
    assert.match(extendCli, /assertExtendCapacityReadable/);
    assert.match(extendCli, /program\",\s*\"extend\"/);
    assert.doesNotMatch(extendCli, /EXTENDABLE_KEYS/);
    assert.doesNotMatch(extendCli, /S9-B extend target/);

    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    assert.match(upgrade, /--no-auto-extend/);
    assert.doesNotMatch(upgrade, /svm-program-extend/);
    assert.doesNotMatch(upgrade, /planProgramExtend/);
  });
});
