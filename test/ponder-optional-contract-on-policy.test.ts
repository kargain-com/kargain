/**
 * Optional-contract Ponder registration: FixedPrice / Ascending / Gateway
 * handlers must use onOptionalContractEvent. Event name determines ABI args
 * (ContractEventArgsFromTopics); eventArgs is deleted. Always-registered
 * contracts keep ponder.on.
 *
 * Bidirectional: OPTIONAL_CONTRACT_ABIS event keys ≡ commercial-abi-events
 * filter for the three contracts; consume + conditional ponder.config.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { listCommercialAbiEvents } from "../lib/svm/commercial-abi-events.ts";
import {
  listOptionalContractEventKeys,
  OPTIONAL_CONTRACT_ABIS,
} from "../src/lib/ponder-optional-contract-events.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OPTIONAL_CONTRACTS = new Set(Object.keys(OPTIONAL_CONTRACT_ABIS));

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Bidirectional key completeness — exported for constructed-violation cases. */
export function findOptionalAbiKeyGaps(
  ownerKeys: readonly string[],
  commercialKeys: readonly string[],
): { missingFromOwner: string[]; missingFromCommercial: string[] } {
  const owner = new Set(ownerKeys);
  const commercial = new Set(commercialKeys);
  return {
    missingFromOwner: [...commercial].filter((k) => !owner.has(k)).sort(),
    missingFromCommercial: [...owner].filter((k) => !commercial.has(k)).sort(),
  };
}

function commercialOptionalKeys(): string[] {
  return listCommercialAbiEvents()
    .filter((e) => OPTIONAL_CONTRACTS.has(e.contract))
    .map((e) => `${e.contract}:${e.event}`)
    .sort();
}

describe("ponder optional-contract registration policy", () => {
  it("owner exports onOptionalContractEvent + OPTIONAL_CONTRACT_ABIS; no eventArgs", () => {
    const on = read("src/lib/ponder-optional-contract-on.ts");
    const events = read("src/lib/ponder-optional-contract-events.ts");
    assert.match(on, /export function onOptionalContractEvent/);
    assert.match(events, /export const OPTIONAL_CONTRACT_ABIS/);
    assert.match(events, /ContractEventArgsFromTopics/);
    assert.doesNotMatch(on, /export function eventArgs/);
    assert.doesNotMatch(events, /eventArgs/);
    assert.match(on, /as unknown as OptionalOn/);
  });

  it("eventArgs symbol is gone from product sources", () => {
    const hits: string[] = [];
    for (const rel of [
      "src/lib/ponder-optional-contract-on.ts",
      "src/lib/ponder-optional-contract-events.ts",
      "src/commerce-handlers.ts",
      "src/bridge-handlers.ts",
    ]) {
      const body = read(rel);
      if (/\beventArgs\b/.test(body)) hits.push(rel);
    }
    assert.deepEqual(hits, [], `eventArgs still referenced in:\n${hits.join("\n")}`);
  });

  it("OPTIONAL_CONTRACT_ABIS keys ≡ commercial-abi-events for the three contracts", () => {
    const gaps = findOptionalAbiKeyGaps(
      listOptionalContractEventKeys(),
      commercialOptionalKeys(),
    );
    assert.deepEqual(gaps.missingFromOwner, []);
    assert.deepEqual(gaps.missingFromCommercial, []);
  });

  it("constructed violation: ABI event missing from owner keys turns red then green", () => {
    const commercial = commercialOptionalKeys();
    const owner = listOptionalContractEventKeys().filter(
      (k) => k !== "FixedPriceConsignment:ConsignmentOpened",
    );
    const red = findOptionalAbiKeyGaps(owner, commercial);
    assert.ok(red.missingFromOwner.includes("FixedPriceConsignment:ConsignmentOpened"));
    const green = findOptionalAbiKeyGaps(
      listOptionalContractEventKeys(),
      commercial,
    );
    assert.deepEqual(green.missingFromOwner, []);
    assert.deepEqual(green.missingFromCommercial, []);
  });

  it("constructed violation: phantom owner key turns red then green", () => {
    const commercial = commercialOptionalKeys();
    const owner = [
      ...listOptionalContractEventKeys(),
      "FixedPriceConsignment:NotARealEvent",
    ];
    const red = findOptionalAbiKeyGaps(owner, commercial);
    assert.ok(red.missingFromCommercial.includes("FixedPriceConsignment:NotARealEvent"));
    const green = findOptionalAbiKeyGaps(
      listOptionalContractEventKeys(),
      commercial,
    );
    assert.deepEqual(green.missingFromOwner, []);
    assert.deepEqual(green.missingFromCommercial, []);
  });

  it("mismatched event name vs args type fails tsc; matching pair passes", () => {
    const probe = path.join(ROOT, "src/lib/__d1-close-event-bind-probe.ts");
    const runIndexerTsc = () =>
      spawnSync(
        "pnpm",
        ["exec", "tsc", "--noEmit", "-p", "tsconfig.indexer.json"],
        { cwd: ROOT, encoding: "utf8" },
      );

    const redSource = `import type { OptionalContractEventArgs } from "./ponder-optional-contract-events";

declare const opened: OptionalContractEventArgs<"FixedPriceConsignment:ConsignmentOpened">;
const bad: OptionalContractEventArgs<"FixedPriceConsignment:ConsignmentFloorLowered"> =
  opened;
void bad;
`;

    const greenSource = `import type { OptionalContractEventArgs } from "./ponder-optional-contract-events";

declare const opened: OptionalContractEventArgs<"FixedPriceConsignment:ConsignmentOpened">;
const ok: OptionalContractEventArgs<"FixedPriceConsignment:ConsignmentOpened"> =
  opened;
void ok;
`;

    try {
      fs.writeFileSync(probe, redSource);
      const red = runIndexerTsc();
      assert.notEqual(
        red.status,
        0,
        `expected mismatch to fail tsc; stdout:\n${red.stdout}\nstderr:\n${red.stderr}`,
      );
      assert.match(
        `${red.stdout}\n${red.stderr}`,
        /__d1-close-event-bind-probe|not assignable/i,
      );

      fs.writeFileSync(probe, greenSource);
      const green = runIndexerTsc();
      assert.equal(
        green.status,
        0,
        `expected matching pair to pass tsc; stdout:\n${green.stdout}\nstderr:\n${green.stderr}`,
      );
    } finally {
      fs.rmSync(probe, { force: true });
    }
  });

  it("commerce and bridge handlers register optional contracts via the owner", () => {
    const commerce = read("src/commerce-handlers.ts");
    const bridge = read("src/bridge-handlers.ts");
    assert.match(commerce, /from "\.\/lib\/ponder-optional-contract-on"/);
    assert.match(bridge, /from "\.\/lib\/ponder-optional-contract-on"/);
    assert.match(commerce, /onOptionalContractEvent\("FixedPriceConsignment:/);
    assert.match(commerce, /onOptionalContractEvent\("AscendingConsignment:/);
    assert.match(bridge, /onOptionalContractEvent\("KarPassportBridgeGateway:/);
    assert.doesNotMatch(commerce, /ponder\.on\("FixedPriceConsignment:/);
    assert.doesNotMatch(commerce, /ponder\.on\("AscendingConsignment:/);
    assert.doesNotMatch(bridge, /ponder\.on\("KarPassportBridgeGateway:/);
  });

  it("ponder.config registers FixedPrice/Ascending/Gateway only when addresses resolve", () => {
    const cfg = read("ponder.config.ts");
    assert.match(cfg, /fixedPriceAddress/);
    assert.match(cfg, /ascendingAddress/);
    assert.match(cfg, /gatewayAddress/);
    assert.match(
      cfg,
      /\.\.\.\(fixedPriceAddress\s*\?[\s\S]*FixedPriceConsignment/,
    );
    assert.match(
      cfg,
      /\.\.\.\(ascendingAddress\s*\?[\s\S]*AscendingConsignment/,
    );
    assert.match(
      cfg,
      /\.\.\.\(gatewayAddress\s*\?[\s\S]*KarPassportBridgeGateway/,
    );
    assert.doesNotMatch(
      cfg,
      /contracts:\s*\{[\s\S]*FixedPriceConsignment:\s*\{[\s\S]*\}\s*,\s*AscendingConsignment:\s*\{/,
    );
  });
});
