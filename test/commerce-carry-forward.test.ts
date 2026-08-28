/**
 * §15.2 step 7 — Carried scenarios still have named green homes after cutover.
 * Code wins over records: this suite fails if a Carried `it` title disappears.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function assertIncludes(rel: string, needle: string) {
  assert.ok(
    source(rel).includes(needle),
    `Carried scenario missing in ${rel}: ${needle}`,
  );
}

describe("commerce carry-forward scenarios (§15.2 step 7)", () => {
  it("Ascending PA1 + reentrancy named scenarios remain", () => {
    const rel = "test/ascending/AscendingConsignment.test.ts";
    assertIncludes(rel, "PA1:");
    assertIncludes(rel, "reentrancy:");
  });

  it("FixedPrice buy/open, external confirm, pause, revoke mid-sale", () => {
    const rel = "test/fixed-price/FixedPriceConsignment.test.ts";
    assertIncludes(rel, "PA1:");
    assertIncludes(rel, "external:");
    assertIncludes(rel, "G3:");
    assertIncludes(rel, "G3 revoke:");
    assertIncludes(rel, "ModeNotEncumbranceSource");
    assertIncludes(rel, "TokenHasNoCode");
    assertIncludes(rel, "TokenDecimalsUnavailable");
    assertIncludes(rel, "StalePrice at admit");
  });

  it("Mandate / Recall / BondedChallenge / ConsignmentBase cores", () => {
    assertIncludes("test/mandate-recall/MandateRecall.test.ts", "Recall:");
    assertIncludes("test/mandate-recall/MandateRecall.test.ts", "RC1:");
    assertIncludes("test/bonded-challenge/BondedChallenge.test.ts", "CH");
    assertIncludes("test/consignment-base/ConsignmentBase.test.ts", "ModeNotEncumbranceSource");
  });

  it("Passport encumbrance may + challenge; mutex / offers / claims product", () => {
    assertIncludes("test/KarPassportEncumbrance.test.ts", "may(");
    assertIncludes("test/passport-sell-surface.test.ts", "live consignment");
    assertIncludes("test/listing-offers.test.ts", "parseListingOffersFromEvents");
    assertIncludes("test/claims-surface.test.ts", "ClaimRecorded");
    assertIncludes("test/commerce-pause-surface.test.ts", "guardian");
  });

  it("Silently lost ledger: pause+UUPS restored; proFeeBps still absent", () => {
    assert.ok(source("contracts/lib/ConsignmentBase.sol").includes("function pause"));
    assert.ok(source("contracts/FixedPriceConsignment.sol").includes("_authorizeUpgrade"));
    assert.ok(source("contracts/AscendingConsignment.sol").includes("setChallengeBond"));
    assert.equal(
      /proFeeBps/.test(source("contracts/FixedPriceConsignment.sol")) ||
        /proFeeBps/.test(source("contracts/AscendingConsignment.sol")),
      false,
      "proFeeBps must remain a recorded absence (no counterpart)",
    );
  });
});
