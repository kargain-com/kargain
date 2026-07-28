import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { REVERT_COPY, resolveRevertCopy } from "../lib/marketplace/tx-error-message.ts";
import {
  ERROR_COVERAGE_REGISTRY,
  parseErrorNames,
} from "./error-coverage-policy.test.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_DIR = path.join(ROOT, "contracts");

const CLAIMABLE_INHERITORS = new Set([
  "AuctionEscrow",
  "MarketplaceEscrow",
  "KarPassport",
  "KarProStaking",
]);

const ERC20_ADMISSION_CONTRACTS = new Set([
  "AuctionEscrow",
  "MarketplaceEscrow",
  "KarProStaking",
]);

function allProductionErrorNames(): string[] {
  const names = new Set<string>();
  for (const entry of ERROR_COVERAGE_REGISTRY) {
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

  it("substring name pairs resolve to the longer name by construction", () => {
    const names = Object.keys(REVERT_COPY);
    for (const longer of names) {
      for (const shorter of names) {
        if (longer === shorter) continue;
        if (!longer.includes(shorter)) continue;
        const message = `reverted with custom error ${longer}()`;
        assert.equal(
          resolveRevertCopy(message),
          REVERT_COPY[longer],
          `${longer} containing ${shorter} must resolve to ${longer}`,
        );
      }
    }
  });

  it("NotSellerOrAgent wins over NotSeller", () => {
    assert.equal(
      resolveRevertCopy("reverted with custom error NotSellerOrAgent()"),
      REVERT_COPY.NotSellerOrAgent,
    );
  });

  it("AuctionHasAgent and ListingHasAgent have distinct copy", () => {
    assert.notEqual(REVERT_COPY.AuctionHasAgent, REVERT_COPY.ListingHasAgent);
    assert.match(REVERT_COPY.AuctionHasAgent!, /auction/i);
    assert.match(REVERT_COPY.ListingHasAgent!, /sale|delist|agent cancel/i);
  });
});
