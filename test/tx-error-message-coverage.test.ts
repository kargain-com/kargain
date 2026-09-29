import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { REVERT_COPY } from "../lib/marketplace/tx-error-message.ts";
import {
  ERROR_COVERAGE_REGISTRY,
  LIB_ERROR_COVERAGE_REGISTRY,
  parseErrorNames,
} from "./error-coverage-policy.test.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");

const CLAIMABLE_INHERITORS = new Set([
  "KarPassport",
  "KarProStaking",
  "FixedPriceConsignment",
  "AscendingConsignment",
]);

const ERC20_ADMISSION_CONTRACTS = new Set([
  "KarProStaking",
  "FixedPriceConsignment",
  "AscendingConsignment",
]);

function allProductionErrorNames(): string[] {
  const names = new Set<string>();
  for (const entry of [...ERROR_COVERAGE_REGISTRY, ...LIB_ERROR_COVERAGE_REGISTRY]) {
    const source = fs.readFileSync(path.join(CONTRACTS_DIR, entry.errorSource), "utf8");
    for (const name of parseErrorNames(source)) names.add(name);
    if (CLAIMABLE_INHERITORS.has(entry.contract)) {
      const claim = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/ClaimablePayouts.sol"),
        "utf8",
      );
      for (const name of parseErrorNames(claim)) names.add(name);
    }
    if (ERC20_ADMISSION_CONTRACTS.has(entry.contract)) {
      const admission = fs.readFileSync(
        path.join(CONTRACTS_DIR, "lib/Erc20Admission.sol"),
        "utf8",
      );
      for (const name of parseErrorNames(admission)) names.add(name);
    }
  }
  return [...names].sort();
}

describe("tx-error-message coverage", () => {
  it("every production custom error resolves to a mapper entry", () => {
    const declared = allProductionErrorNames();
    const missing = declared.filter((name) => REVERT_COPY[name] == null);
    assert.deepEqual(
      missing,
      [],
      `REVERT_COPY missing errors:\n${missing.map((m) => `  ${m}`).join("\n")}`,
    );
  });

  it("every mapper message is pairwise distinct", () => {
    const byMessage = new Map<string, string[]>();
    for (const [name, message] of Object.entries(REVERT_COPY)) {
      const list = byMessage.get(message) ?? [];
      list.push(name);
      byMessage.set(message, list);
    }
    const collisions = [...byMessage.entries()].filter(([, names]) => names.length > 1);
    assert.equal(
      collisions.length,
      0,
      `Shared messages:\n${collisions
        .map(([msg, names]) => `  ${names.join(", ")} → ${msg}`)
        .join("\n")}`,
    );
  });

  it("substring name pairs keep distinct REVERT_COPY sentences", () => {
    const names = Object.keys(REVERT_COPY);
    for (const longer of names) {
      for (const shorter of names) {
        if (longer === shorter) continue;
        if (!longer.includes(shorter)) continue;
        assert.notEqual(
          REVERT_COPY[longer],
          REVERT_COPY[shorter],
          `${longer} and ${shorter} must not share chrome copy`,
        );
      }
    }
  });

  it("NotSellerOrAgent and NotConsignmentSeller keep distinct copy", () => {
    assert.ok(REVERT_COPY.NotSellerOrAgent);
    assert.notEqual(
      REVERT_COPY.NotConsignmentSeller,
      REVERT_COPY.NotConsignmentRunner,
    );
  });

  it("BridgeGatewayUnbound names the network passport program (not a token)", () => {
    assert.equal(
      REVERT_COPY.BridgeGatewayUnbound,
      "This network's passport program has no bridge gateway bound.",
    );
    assert.ok(
      !REVERT_COPY.BridgeGatewayUnbound.toLowerCase().includes("this passport has"),
      "must not scope unbound to a token",
    );
  });

  it("mapper carries no copy for retired escrow errors", () => {
    for (const retired of [
      "AlreadyListed",
      "AuctionExists",
      "NoAuction",
      "AgentNotAuthorized",
      "RefundPending",
      "RefundNotPending",
      "NotSeller",
      "NoAgent",
      "ListingHasAgent",
      "AuctionHasAgent",
      "NotActive",
      "HoldReleased",
    ]) {
      assert.equal(REVERT_COPY[retired], undefined, `${retired} must be removed`);
    }
  });

  it("owner source has no resolveRevertCopy / decodeSvmProgramError / raw message arm", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "lib/marketplace/tx-error-message.ts"),
      "utf8",
    );
    assert.doesNotMatch(src, /\bresolveRevertCopy\b/);
    assert.doesNotMatch(src, /\bdecodeSvmProgramError\b/);
    assert.doesNotMatch(src, /\bextractSvmProgramErrorOrdinal\b/);
    assert.doesNotMatch(src, /err\.message/);
  });
});
