import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  requireCommercialActive,
} from "../lib/web3/commercial-active.ts";
import { ETHEREUM_SEPOLIA_SPOKE, SEPOLIA_ACTIVE } from "../lib/web3/sepolia-addresses.ts";
import {
  ponderAddressesFromStack,
  resolveCommercialStack,
} from "../scripts/lib/resolve-sepolia-stack.ts";

const HUB = 84532;
const ETH = 11155111;

describe("COMMERCIAL_ACTIVE registry", () => {
  it("includes Nuclear #2 hub and Eth stacks with modes", () => {
    assert.equal(Object.keys(COMMERCIAL_ACTIVE).sort().join(","), `${ETH},${HUB}`);
    assert.equal(requireCommercialActive(HUB).karPassport, SEPOLIA_ACTIVE.karPassport);
    assert.equal(
      requireCommercialActive(ETH).karPassport,
      "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0",
    );
    assert.equal(
      requireCommercialActive(HUB).fixedPriceConsignment,
      "0xE98EbDb9354ff9c91872390D7106D621794C9118",
    );
    assert.equal(
      requireCommercialActive(ETH).ascendingConsignment,
      "0xe8ECf3b42b489F6289434840661770b43B027F13",
    );
  });

  it("SEPOLIA_ACTIVE aliases COMMERCIAL_ACTIVE[84532]", () => {
    assert.equal(SEPOLIA_ACTIVE, COMMERCIAL_ACTIVE[HUB]);
    assert.equal(SEPOLIA_ACTIVE.indexFromBlock, 44_833_462);
  });

  it("ETHEREUM_SEPOLIA_SPOKE points at Nuclear #2 Eth KarPassport", () => {
    const eth = requireCommercialActive(ETH);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.karPassportOnft, eth.karPassport);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.bridgeGateway, eth.bridgeGateway);
    assert.notEqual(
      ETHEREUM_SEPOLIA_SPOKE.karPassportOnft,
      "0x5b7fD0ffF9B82255AD4d043a491e81948b76e703",
    );
  });

  it("requireCommercialActive fails closed on unknown chain", () => {
    assert.equal(commercialActive(1), undefined);
    assert.throws(() => requireCommercialActive(1), /No COMMERCIAL_ACTIVE entry for chain 1/);
  });
});

describe("resolveCommercialStack committed fallback", () => {
  it("returns committed Eth stack matching SPEC I.9.2", () => {
    // Prefer registry path: clear env overrides that would force hub "env" source.
    const prev = {
      passport: process.env.PONDER_KAR_PASSPORT_ADDRESS,
      pro: process.env.PONDER_KAR_PRO_PASS_ADDRESS,
      staking: process.env.PONDER_KAR_PRO_STAKING_ADDRESS,
    };
    try {
      delete process.env.PONDER_KAR_PASSPORT_ADDRESS;
      delete process.env.PONDER_KAR_PRO_PASS_ADDRESS;
      delete process.env.PONDER_KAR_PRO_STAKING_ADDRESS;

      const eth = resolveCommercialStack(ETH);
      assert.ok(eth.source === "committed" || eth.source === "manifest");
      assert.equal(eth.karPassport, "0xC219bf834B8965339b95C0B6Afe3c4d0F1266Fb0");
      assert.equal(eth.indexFromBlock, 11_384_136);
      assert.equal(eth.bridgeGateway, "0xd2c6EAdc9c03741D6A44dB5CF54f520Ee774b655");

      const bundle = ponderAddressesFromStack(eth);
      assert.equal(bundle.karPassport, eth.karPassport);
      assert.equal(bundle.fixedPriceConsignment, eth.fixedPriceConsignment);
      assert.equal(bundle.ascendingConsignment, eth.ascendingConsignment);

      const hub = resolveCommercialStack(HUB);
      assert.ok(hub.source === "committed" || hub.source === "manifest" || hub.source === "env");
      assert.equal(hub.karPassport, SEPOLIA_ACTIVE.karPassport);
      assert.equal(hub.fixedPriceConsignment, SEPOLIA_ACTIVE.fixedPriceConsignment);
    } finally {
      if (prev.passport) process.env.PONDER_KAR_PASSPORT_ADDRESS = prev.passport;
      else delete process.env.PONDER_KAR_PASSPORT_ADDRESS;
      if (prev.pro) process.env.PONDER_KAR_PRO_PASS_ADDRESS = prev.pro;
      else delete process.env.PONDER_KAR_PRO_PASS_ADDRESS;
      if (prev.staking) process.env.PONDER_KAR_PRO_STAKING_ADDRESS = prev.staking;
      else delete process.env.PONDER_KAR_PRO_STAKING_ADDRESS;
    }
  });

  it("falls back to committed when no local manifest", async () => {
    const { rename, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(process.cwd(), "deployments/11155111.json");
    const bak = `${path}.bak-commercial-active-test`;
    let moved = false;
    try {
      await access(path);
      await rename(path, bak);
      moved = true;
    } catch {
      // already absent — committed path is the default
    }
    try {
      delete process.env.PONDER_KAR_PASSPORT_ADDRESS;
      delete process.env.PONDER_KAR_PRO_PASS_ADDRESS;
      delete process.env.PONDER_KAR_PRO_STAKING_ADDRESS;
      const eth = resolveCommercialStack(ETH);
      assert.equal(eth.source, "committed");
      assert.equal(eth.karPassport, requireCommercialActive(ETH).karPassport);
    } finally {
      if (moved) await rename(bak, path);
    }
  });

  it("throws for unknown commercial chainId", () => {
    assert.throws(() => resolveCommercialStack(999), /No COMMERCIAL_ACTIVE entry/);
  });
});
