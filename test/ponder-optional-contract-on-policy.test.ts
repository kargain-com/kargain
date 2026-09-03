/**
 * Optional-contract Ponder registration: FixedPrice / Ascending / Gateway
 * handlers must use onOptionalContractEvent (EventNames omits address-
 * conditional createConfig keys). Always-registered contracts keep ponder.on.
 *
 * Bidirectional: owner export consumed; conditional registration in
 * ponder.config.ts preserved (no always-register).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("ponder optional-contract registration policy", () => {
  it("owner exports onOptionalContractEvent and eventArgs", () => {
    const src = read("src/lib/ponder-optional-contract-on.ts");
    assert.match(src, /export function onOptionalContractEvent/);
    assert.match(src, /export function eventArgs/);
    assert.match(src, /FixedPriceConsignment:\$\{string\}/);
    assert.match(src, /AscendingConsignment:\$\{string\}/);
    assert.match(src, /KarPassportBridgeGateway:\$\{string\}/);
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
    // Constructed violation shape: unconditional key without address gate.
    assert.doesNotMatch(
      cfg,
      /contracts:\s*\{[\s\S]*FixedPriceConsignment:\s*\{[\s\S]*\}\s*,\s*AscendingConsignment:\s*\{/,
    );
  });
});
