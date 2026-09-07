/**
 * Sole startup-retention predicate — ingest + upgrade dry-run.
 * Bidirectional: owner behaviour + consumer imports.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateStartupRetention,
  STARTUP_RETENTION_UNAVAILABLE,
  startupRetentionUnavailableMessage,
} from "../lib/svm/startup-retention.ts";
import {
  formatUpgradePlannedChangeTable,
  isAbsentProgramShowFailure,
  isTransportCliFailure,
  maskBase58Id,
  sanitizeCliDetail,
} from "../scripts/lib/svm-upgrade-in-place-preflight.ts";
import { assertProgramShowAllowsUpgrade } from "../scripts/lib/svm-upgrade-in-place-assert.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("svm-startup-retention-policy", () => {
  it("refuses by name when required slot is before first available (and at/under tip)", () => {
    const result = evaluateStartupRetention({
      requiredSlot: 100,
      firstAvailableBlock: 200,
      headSlot: 500,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected refuse");
    assert.equal(result.incident, STARTUP_RETENTION_UNAVAILABLE);
    assert.equal(result.detail.reason, "required_slot_before_first_available_block");
    assert.equal(result.detail.requiredSlot, 100);
    assert.equal(result.detail.firstAvailableBlock, 200);
    assert.equal(result.detail.headSlot, 500);
    assert.match(
      startupRetentionUnavailableMessage(result.detail),
      /required slot 100 is before first available block 200/,
    );
  });

  it("accepts when required slot is retained or still in the future", () => {
    assert.equal(
      evaluateStartupRetention({
        requiredSlot: 200,
        firstAvailableBlock: 100,
        headSlot: 500,
      }).ok,
      true,
    );
    assert.equal(
      evaluateStartupRetention({
        requiredSlot: 200,
        firstAvailableBlock: 200,
        headSlot: 500,
      }).ok,
      true,
    );
    assert.equal(
      evaluateStartupRetention({
        requiredSlot: 600,
        firstAvailableBlock: 100,
        headSlot: 500,
      }).ok,
      true,
    );
  });

  it("constructed dual-path inequality without the owner would diverge — pin boundary", () => {
    // Future required slot that sits below firstAvailable: owner accepts (required > head);
    // a head-blind "required < firstAvailable ⇒ refuse" dual path would wrongly refuse.
    const futureBelowFirst = {
      requiredSlot: 600,
      firstAvailableBlock: 700,
      headSlot: 500,
    };
    const headBlindRefuse =
      futureBelowFirst.requiredSlot < futureBelowFirst.firstAvailableBlock;
    assert.equal(headBlindRefuse, true);
    assert.equal(evaluateStartupRetention(futureBelowFirst).ok, true);

    const underTipUnretained = {
      requiredSlot: 50,
      firstAvailableBlock: 100,
      headSlot: 500,
    };
    assert.equal(evaluateStartupRetention(underTipUnretained).ok, false);
  });

  it("ingest-loop and upgrade-in-place consume the owner (no parallel predicate)", () => {
    const ingest = readFileSync(
      join(ROOT, "src/svm-ingest/ingest-loop.ts"),
      "utf8",
    );
    const upgrade = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    assert.match(ingest, /evaluateStartupRetention/);
    assert.match(ingest, /from ["'].*startup-retention/);
    assert.match(upgrade, /evaluateStartupRetention/);
    assert.match(upgrade, /from ["'].*startup-retention/);
    assert.doesNotMatch(
      ingest,
      /requiredSlot >= firstAvailableBlock/,
      "ingest must not keep a parallel retention inequality",
    );
  });

  it("dry-run path: stop rules via show assert; source never writes on dry-run branch", () => {
    assert.throws(
      () =>
        assertProgramShowAllowsUpgrade({
          showText: "Owner: Tokenkeg\nAuthority: Deployer",
          programId: "Prog",
          deployerPubkey: "Deployer",
          evidenceKey: "kar_passport",
        }),
      /not owned by the upgradeable loader/,
    );

    const upgradeSrc = readFileSync(
      join(ROOT, "scripts/svm-upgrade-in-place.ts"),
      "utf8",
    );
    assert.match(upgradeSrc, /hasFlag\(["']--dry-run["']\)/);
    assert.match(upgradeSrc, /DRY-RUN complete/);
    // Read-only show must carry --keypair (CLI requires a default signer even for show).
    assert.match(
      upgradeSrc,
      /program["\s,\n]+show[\s\S]*?--keypair[\s\S]*?deployerKp/,
    );
    // After dry-run early continue/return, merge must not run.
    const dryReturnIdx = upgradeSrc.indexOf("DRY-RUN complete");
    const mergeIdx = upgradeSrc.indexOf("mergeAndWriteSvmDevnetEvidence(evidencePath");
    assert.ok(dryReturnIdx > 0, "dry-run completion marker required");
    assert.ok(mergeIdx > dryReturnIdx, "evidence write must follow dry-run return");

    const shell = readFileSync(
      join(ROOT, "svm/scripts/upgrade-pre-s7a-four.sh"),
      "utf8",
    );
    assert.match(shell, /--dry-run/);
    assert.match(shell, /S9-B-2/);
    assert.match(shell, /DRY_RUN_ARGS/);
  });

  it("planned-change table masks ids and formats digests", () => {
    assert.equal(maskBase58Id("ArvcryxBL1mP44Vo4MoK1FE3YCnNG8JdVa3iTKxgWnTQ"), "Arvc…WnTQ");
    const table = formatUpgradePlannedChangeTable([
      {
        evidenceKey: "kar_passport",
        maskedProgramId: "Arvc…WnTQ",
        priorDigest: "absent",
        newDigest: "abc",
        priorDeploySlot: "490505668",
        soBytes: 12,
      },
    ]);
    assert.match(table, /kar_passport/);
    assert.match(table, /Arvc…WnTQ/);
    assert.match(table, /absent/);
    assert.match(table, /490505668/);
  });

  it("CLI detail sanitize + transport vs absent classification", () => {
    const transport =
      "AccountNotFound: pubkey=4TE2kf7N4F43ab1436KA71ZwKKokdGt7ANRDbreWbnHr: error sending request for url (https://api.devnet.solana.com/)";
    assert.equal(isTransportCliFailure(transport), true);
    assert.equal(isAbsentProgramShowFailure(transport), false);
    const sanitized = sanitizeCliDetail(transport);
    assert.doesNotMatch(sanitized, /https?:\/\//);
    assert.match(sanitized, /<RPC>/);
    assert.equal(
      isAbsentProgramShowFailure("Unable to find the account for program"),
      true,
    );
  });
});
