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
  it("includes Nuclear hub and Eth stacks", () => {
    assert.equal(Object.keys(COMMERCIAL_ACTIVE).sort().join(","), `${ETH},${HUB}`);
    assert.equal(requireCommercialActive(HUB).karPassport, SEPOLIA_ACTIVE.karPassport);
    assert.equal(
      requireCommercialActive(ETH).karPassport,
      "0x6378469256907D7DC14BBfce0261ceDE22314507",
    );
  });

  it("SEPOLIA_ACTIVE aliases COMMERCIAL_ACTIVE[84532]", () => {
    assert.equal(SEPOLIA_ACTIVE, COMMERCIAL_ACTIVE[HUB]);
    assert.equal(SEPOLIA_ACTIVE.indexFromBlock, 44_434_865);
  });

  it("ETHEREUM_SEPOLIA_SPOKE points at Nuclear Eth KarPassport", () => {
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
      assert.equal(eth.karPassport, "0x6378469256907D7DC14BBfce0261ceDE22314507");
      assert.equal(eth.indexFromBlock, 11_319_840);
      assert.equal(eth.bridgeGateway, "0xEBcd44736C7F1E8Bf3E5f1c98D176732eB134eAB");

      const bundle = ponderAddressesFromStack(eth);
      assert.equal(bundle.karPassport, eth.karPassport);
      assert.equal(bundle.fixedPriceConsignment, undefined);
      assert.equal(bundle.ascendingConsignment, undefined);

      const hub = resolveCommercialStack(HUB);
      assert.ok(hub.source === "committed" || hub.source === "manifest" || hub.source === "env");
      assert.equal(hub.karPassport, SEPOLIA_ACTIVE.karPassport);
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
