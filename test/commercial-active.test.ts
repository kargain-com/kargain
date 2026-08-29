import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  requireCommercialActive,
} from "../lib/web3/commercial-active.ts";
import { kargainContractDenylist } from "../lib/web3/deployment-addresses.ts";
import { ETHEREUM_SEPOLIA_SPOKE, SEPOLIA_ACTIVE } from "../lib/web3/sepolia-addresses.ts";
import {
  ponderAddressesFromStack,
  resolveCommercialStack,
} from "../scripts/lib/resolve-sepolia-stack.ts";

const HUB = 84532;
const ETH = 11155111;

/** Point the deployment loader at an empty temp dir so repo manifests are invisible. */
function withEmptyDeploymentsDir<T>(fn: () => T): T {
  const prev = process.env.KARGAIN_DEPLOYMENTS_DIR;
  const temp = mkdtempSync(join(tmpdir(), "kargain-deployments-"));
  process.env.KARGAIN_DEPLOYMENTS_DIR = temp;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.KARGAIN_DEPLOYMENTS_DIR;
    else process.env.KARGAIN_DEPLOYMENTS_DIR = prev;
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("COMMERCIAL_ACTIVE registry", () => {
  it("includes Nuclear #4 hub and Eth stacks with modes", () => {
    assert.equal(Object.keys(COMMERCIAL_ACTIVE).sort().join(","), `${ETH},${HUB}`);
    assert.equal(requireCommercialActive(HUB).karPassport, SEPOLIA_ACTIVE.karPassport);
    assert.equal(
      requireCommercialActive(ETH).karPassport,
      "0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC",
    );
    assert.equal(
      requireCommercialActive(HUB).fixedPriceConsignment,
      "0x73F41293bb207443990006b951CE9BC38Ef2eB3b",
    );
    assert.equal(
      requireCommercialActive(ETH).ascendingConsignment,
      "0xbFdA994743feF37b268aA70ffF8a91eF3d10936E",
    );
  });

  it("SEPOLIA_ACTIVE aliases COMMERCIAL_ACTIVE[84532]", () => {
    assert.equal(SEPOLIA_ACTIVE, COMMERCIAL_ACTIVE[HUB]);
    assert.equal(SEPOLIA_ACTIVE.indexFromBlock, 44_957_457);
  });

  it("ETHEREUM_SEPOLIA_SPOKE points at Nuclear #4 Eth KarPassport", () => {
    const eth = requireCommercialActive(ETH);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.karPassportOnft, eth.karPassport);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.bridgeGateway, eth.bridgeGateway);
    assert.notEqual(
      ETHEREUM_SEPOLIA_SPOKE.karPassportOnft,
      "0x5b7fD0ffF9B82255AD4d043a491e81948b76e703",
    );
    assert.notEqual(
      ETHEREUM_SEPOLIA_SPOKE.karPassportOnft,
      "0xc903feE4395dd5Db35d9BcB558917f3Af8d71869",
    );
  });

  it("Nuclear #3 passports are denylisted, not active", () => {
    const hubDeny = new Set(kargainContractDenylist(HUB).map((a) => a.toLowerCase()));
    const ethDeny = new Set(kargainContractDenylist(ETH).map((a) => a.toLowerCase()));
    assert.ok(hubDeny.has("0xef7403424ce96f0e1845ab70800022c78d97a52c"));
    assert.ok(ethDeny.has("0xc903fee4395dd5db35d9bcb558917f3af8d71869"));
    assert.notEqual(
      requireCommercialActive(HUB).karPassport.toLowerCase(),
      "0xef7403424ce96f0e1845ab70800022c78d97a52c",
    );
    assert.notEqual(
      requireCommercialActive(ETH).karPassport.toLowerCase(),
      "0xc903fee4395dd5db35d9bcb558917f3af8d71869",
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
    // Empty KARGAIN_DEPLOYMENTS_DIR so local N5/N6 manifests cannot shadow COMMERCIAL_ACTIVE.
    const prev = {
      passport: process.env.PONDER_KAR_PASSPORT_ADDRESS,
      pro: process.env.PONDER_KAR_PRO_PASS_ADDRESS,
      staking: process.env.PONDER_KAR_PRO_STAKING_ADDRESS,
    };
    withEmptyDeploymentsDir(() => {
      try {
        delete process.env.PONDER_KAR_PASSPORT_ADDRESS;
        delete process.env.PONDER_KAR_PRO_PASS_ADDRESS;
        delete process.env.PONDER_KAR_PRO_STAKING_ADDRESS;

        const eth = resolveCommercialStack(ETH);
        assert.equal(eth.source, "committed");
        assert.equal(eth.karPassport, "0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC");
        assert.equal(eth.indexFromBlock, 11_404_204);
        assert.equal(eth.bridgeGateway, "0xec44167ab1e2619C9aCaA87F5B06DcAFe1BF7269");

        const bundle = ponderAddressesFromStack(eth);
        assert.equal(bundle.karPassport, eth.karPassport);
        assert.equal(bundle.fixedPriceConsignment, eth.fixedPriceConsignment);
        assert.equal(bundle.ascendingConsignment, eth.ascendingConsignment);

        const hub = resolveCommercialStack(HUB);
        assert.ok(hub.source === "committed" || hub.source === "env");
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
  });

  it("falls back to committed when no local manifest", () => {
    withEmptyDeploymentsDir(() => {
      delete process.env.PONDER_KAR_PASSPORT_ADDRESS;
      delete process.env.PONDER_KAR_PRO_PASS_ADDRESS;
      delete process.env.PONDER_KAR_PRO_STAKING_ADDRESS;
      const eth = resolveCommercialStack(ETH);
      assert.equal(eth.source, "committed");
      assert.equal(eth.karPassport, requireCommercialActive(ETH).karPassport);
    });
  });

  it("throws for unknown commercial chainId", () => {
    assert.throws(() => resolveCommercialStack(999), /No COMMERCIAL_ACTIVE entry/);
  });
});
