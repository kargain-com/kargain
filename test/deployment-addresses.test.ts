import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";
import {
  ascendingConsignmentAddress,
  fixedPriceConsignmentAddress,
  kargainContractDenylist,
  karPassportAddress,
} from "../lib/web3/deployment-addresses.ts";
import { SEPOLIA_ACTIVE } from "../lib/web3/sepolia-addresses.ts";
import { kargainChains } from "../lib/web3/supported-chains.ts";

const HUB = COMMERCIAL_ACTIVE[84532]!;
const SPOKE = COMMERCIAL_ACTIVE[11155111]!;

describe("resolveAddress commercial fallback", () => {
  it("resolves hub addresses on 84532", () => {
    assert.equal(karPassportAddress(84532), HUB.karPassport);
  });

  it("resolves spoke addresses on 11155111", () => {
    assert.equal(karPassportAddress(11155111), SPOKE.karPassport);
  });

  it("returns undefined for unknown chain", () => {
    assert.equal(karPassportAddress(1), undefined);
  });
});

describe("commerce mode resolvers (Nuclear #2 live)", () => {
  it("fixedPriceConsignmentAddress resolves on both commercial stacks", () => {
    assert.equal(fixedPriceConsignmentAddress(84532), HUB.fixedPriceConsignment);
    assert.equal(fixedPriceConsignmentAddress(11155111), SPOKE.fixedPriceConsignment);
  });

  it("ascendingConsignmentAddress resolves on both commercial stacks", () => {
    assert.equal(ascendingConsignmentAddress(84532), HUB.ascendingConsignment);
    assert.equal(ascendingConsignmentAddress(11155111), SPOKE.ascendingConsignment);
  });

  it("returns undefined for unknown chain", () => {
    assert.equal(fixedPriceConsignmentAddress(1), undefined);
    assert.equal(ascendingConsignmentAddress(1), undefined);
  });
});

describe("kargainContractDenylist per-chain", () => {
  it("84532 includes hub actives and historical spoke hexes", () => {
    const list = kargainContractDenylist(84532).map((a) => a.toLowerCase());
    assert.ok(list.includes(HUB.karPassport.toLowerCase()));
    assert.ok(list.includes(HUB.bridgeGateway.toLowerCase()));
  });

  it("11155111 includes spoke actives; hub Nuclear passport is not required", () => {
    const list = kargainContractDenylist(11155111).map((a) => a.toLowerCase());
    assert.ok(list.includes(SPOKE.karPassport.toLowerCase()));
    assert.ok(list.includes(SPOKE.karProPass.toLowerCase()));
    assert.ok(list.includes(SPOKE.bridgeGateway.toLowerCase()));
    assert.equal(list.includes(SEPOLIA_ACTIVE.karPassport.toLowerCase()), false);
  });

  it("unknown chain returns empty", () => {
    assert.deepEqual(kargainContractDenylist(1), []);
  });
});

describe("kargainChains write-union", () => {
  it("includes Ethereum Sepolia 11155111", () => {
    assert.ok(kargainChains.some((c) => c.id === 11155111));
  });

  it("keeps Base Sepolia 84532", () => {
    assert.ok(kargainChains.some((c) => c.id === 84532));
  });
});
