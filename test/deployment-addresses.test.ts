import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";
import {
  auctionEscrowAddress,
  kargainContractDenylist,
  karPassportAddress,
  marketplaceAddress,
} from "../lib/web3/deployment-addresses.ts";
import { SEPOLIA_ACTIVE } from "../lib/web3/sepolia-addresses.ts";
import { kargainChains } from "../lib/web3/supported-chains.ts";

const HUB = COMMERCIAL_ACTIVE[84532]!;
const SPOKE = COMMERCIAL_ACTIVE[11155111]!;

describe("resolveAddress commercial fallback", () => {
  it("resolves hub addresses on 84532", () => {
    assert.equal(karPassportAddress(84532), HUB.karPassport);
    assert.equal(marketplaceAddress(84532), HUB.marketplace);
    assert.equal(auctionEscrowAddress(84532), HUB.auctionEscrow);
  });

  it("resolves spoke addresses on 11155111", () => {
    assert.equal(karPassportAddress(11155111), SPOKE.karPassport);
    assert.equal(marketplaceAddress(11155111), SPOKE.marketplace);
    assert.equal(auctionEscrowAddress(11155111), SPOKE.auctionEscrow);
  });

  it("returns undefined for unknown chain", () => {
    assert.equal(karPassportAddress(1), undefined);
    assert.equal(marketplaceAddress(1), undefined);
    assert.equal(auctionEscrowAddress(1), undefined);
  });
});

describe("kargainContractDenylist per-chain", () => {
  it("84532 includes hub actives and historical spoke hexes", () => {
    const list = kargainContractDenylist(84532).map((a) => a.toLowerCase());
    assert.ok(list.includes(HUB.karPassport.toLowerCase()));
    assert.ok(list.includes(HUB.marketplace.toLowerCase()));
    assert.ok(list.includes(SPOKE.karPassport.toLowerCase()));
    assert.ok(list.includes(SPOKE.marketplace.toLowerCase()));
  });

  it("11155111 includes spoke actives; hub Nuclear passport is not required", () => {
    const list = kargainContractDenylist(11155111).map((a) => a.toLowerCase());
    assert.ok(list.includes(SPOKE.karPassport.toLowerCase()));
    assert.ok(list.includes(SPOKE.marketplace.toLowerCase()));
    assert.ok(list.includes(SPOKE.karProPass.toLowerCase()));
    assert.ok(list.includes(SPOKE.auctionEscrow.toLowerCase()));
    assert.ok(list.includes(SPOKE.proxyOnftAdapter.toLowerCase()));
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
