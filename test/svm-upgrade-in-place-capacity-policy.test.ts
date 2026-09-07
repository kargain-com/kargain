/**
 * Upgrade-in-place capacity + payer cost predicates.
 * Negative controls call the real evaluate* owners (not re-implemented).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertArtifactFitsProgramCapacity,
  assertPayerCoversUpgradeCost,
  evaluateArtifactCapacityFit,
  evaluatePayerCoversUpgradeCost,
  parseProgramDataCapacityBytes,
  PROGRAM_DATA_CAPACITY_INSUFFICIENT,
  PAYER_BALANCE_INSUFFICIENT_FOR_UPGRADE,
} from "../scripts/lib/svm-upgrade-in-place-assert.ts";
import {
  parseBalanceLamports,
  parseRentExemptLamports,
} from "../scripts/lib/svm-upgrade-in-place-preflight.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-upgrade-in-place-capacity-policy", () => {
  it("parses Data Length / dataLen as program-data capacity", () => {
    assert.equal(
      parseProgramDataCapacityBytes(
        "Data Length: 191128 (0x2ea98) bytes\nAuthority: X",
      ),
      191128,
    );
    assert.equal(
      parseProgramDataCapacityBytes('{"dataLen":218192,"authority":"Y"}'),
      218192,
    );
    assert.throws(
      () => parseProgramDataCapacityBytes("Owner: BPFLoader\nAuthority: X"),
      /missing Data Length/,
    );
  });

  it("RED then green: artifact larger than deployed capacity", () => {
    const red = evaluateArtifactCapacityFit({
      evidenceKey: "kar_passport",
      programId: "Prog1111111111111111111111111111111111111",
      deployedCapacityBytes: 191128,
      artifactBytes: 262016,
    });
    assert.equal(red.ok, false);
    if (red.ok) throw new Error("expected capacity refuse");
    assert.equal(red.causeCode, PROGRAM_DATA_CAPACITY_INSUFFICIENT);
    assert.equal(red.deployedCapacityBytes, 191128);
    assert.equal(red.artifactBytes, 262016);
    assert.equal(red.deficitBytes, 70888);
    assert.match(red.message, /program-data capacity insufficient/);
    assert.match(red.message, /deficitBytes=70888/);
    assert.match(red.message, /extend is a separate founder-approved operation/);

    assert.throws(
      () =>
        assertArtifactFitsProgramCapacity({
          evidenceKey: "kar_passport",
          programId: "Prog1111111111111111111111111111111111111",
          deployedCapacityBytes: 191128,
          artifactBytes: 262016,
        }),
      /program-data capacity insufficient/,
    );

    const green = evaluateArtifactCapacityFit({
      evidenceKey: "kar_gateway",
      programId: "Gate1111111111111111111111111111111111111",
      deployedCapacityBytes: 400000,
      artifactBytes: 223904,
    });
    assert.equal(green.ok, true);
    assertArtifactFitsProgramCapacity({
      evidenceKey: "kar_gateway",
      programId: "Gate1111111111111111111111111111111111111",
      deployedCapacityBytes: 400000,
      artifactBytes: 223904,
    });
  });

  it("RED then green: payer balance below estimated buffer-rent cost", () => {
    const red = evaluatePayerCoversUpgradeCost({
      payerLamports: 1_000,
      estimatedCostLamports: 5_000_000,
    });
    assert.equal(red.ok, false);
    if (red.ok) throw new Error("expected payer refuse");
    assert.equal(red.causeCode, PAYER_BALANCE_INSUFFICIENT_FOR_UPGRADE);
    assert.equal(red.payerLamports, 1_000);
    assert.equal(red.estimatedCostLamports, 5_000_000);
    assert.match(red.message, /payer balance insufficient/);
    assert.match(red.message, /payerLamports=1000/);
    assert.match(red.message, /estimatedCostLamports=5000000/);

    assert.throws(
      () =>
        assertPayerCoversUpgradeCost({
          payerLamports: 1_000,
          estimatedCostLamports: 5_000_000,
        }),
      /payer balance insufficient/,
    );

    const green = evaluatePayerCoversUpgradeCost({
      payerLamports: 10_000_000,
      estimatedCostLamports: 5_000_000,
    });
    assert.equal(green.ok, true);
    assertPayerCoversUpgradeCost({
      payerLamports: 10_000_000,
      estimatedCostLamports: 5_000_000,
    });
  });

  it("parses solana rent / balance --lamports outputs", () => {
    assert.equal(
      parseRentExemptLamports("Rent-exempt minimum: 1331691520 lamports\n"),
      1331691520,
    );
    assert.equal(parseBalanceLamports("19130523350 lamports\n"), 19130523350);
  });

  it("upgrade path consumes capacity/cost owners and passes --no-auto-extend", () => {
    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    assert.match(upgrade, /evaluateArtifactCapacityFit/);
    assert.match(upgrade, /assertPayerCoversUpgradeCost/);
    assert.match(upgrade, /parseProgramDataCapacityBytes/);
    assert.match(upgrade, /--no-auto-extend/);
    assert.match(upgrade, /formatUpgradeProgramStatusTable/);
    assert.doesNotMatch(
      upgrade,
      /requiredSlot >= firstAvailableBlock/,
      "must not reintroduce dual retention inequality",
    );
  });
});
