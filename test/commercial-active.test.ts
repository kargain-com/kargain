import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  commercialActive,
  requireCommercialActive,
  requireEvmCommercialActive,
} from "../lib/web3/commercial-active.ts";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.ts";
import { kargainContractDenylist } from "../lib/web3/deployment-addresses.ts";
import { ETHEREUM_SEPOLIA_SPOKE, SEPOLIA_ACTIVE, SEPOLIA_HISTORICAL_DENYLIST, ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST } from "../lib/web3/sepolia-addresses.ts";
import {
  ponderAddressesFromStack,
  resolveCommercialStack,
} from "../scripts/lib/resolve-sepolia-stack.ts";

const HUB = 84532;
const ETH = 11155111;
const SOLANA = namespaceFromLayerZeroEid(40168);

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
  it("requireEvmCommercialActive narrows to EVM stack with chainId", () => {
    const hub = requireEvmCommercialActive(HUB);
    assert.equal(hub.vm, "evm");
    assert.equal(hub.chainId, HUB);
    assert.equal(hub.karPassport, SEPOLIA_ACTIVE.karPassport);
    const eth = requireEvmCommercialActive(ETH);
    assert.equal(eth.vm, "evm");
    assert.equal(eth.chainId, ETH);
  });

  it("includes Nuclear #7 hub and Eth stacks plus the live Solana row", () => {
    assert.equal(
      Object.keys(COMMERCIAL_ACTIVE).sort().join(","),
      `${ETH},${SOLANA},${HUB}`,
    );
    assert.equal(requireCommercialActive(HUB).karPassport, SEPOLIA_ACTIVE.karPassport);
    assert.equal(
      requireCommercialActive(ETH).karPassport,
      "0x1FFdEC27d14567B34548BA63269c0745227f1949",
    );
    assert.equal(
      requireCommercialActive(HUB).fixedPriceConsignment,
      "0xEc97fC815055CBD51746F7D6966340a1318Ac6F8",
    );
    assert.equal(
      requireCommercialActive(ETH).ascendingConsignment,
      "0x233B0e6780d52275caE1f1d08035F6a3C932B99E",
    );
    const solana = requireCommercialActive(SOLANA);
    assert.equal(solana.vm, "svm");
    assert.equal(solana.usdc, "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    assert.equal(solana.blocks.karProStaking, 490_463_509);
    assert.equal(solana.blocks.ascendingConsignment, 493_101_099);
  });

  it("SEPOLIA_ACTIVE aliases COMMERCIAL_ACTIVE[84532]", () => {
    assert.equal(SEPOLIA_ACTIVE, COMMERCIAL_ACTIVE[HUB]);
    assert.equal(SEPOLIA_ACTIVE.indexFromBlock, 46_119_704);
  });

  it("ETHEREUM_SEPOLIA_SPOKE points at Nuclear #7 Eth KarPassport", () => {
    const eth = requireCommercialActive(ETH);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.karPassportOnft, eth.karPassport);
    assert.equal(ETHEREUM_SEPOLIA_SPOKE.bridgeGateway, eth.bridgeGateway);
    assert.notEqual(
      ETHEREUM_SEPOLIA_SPOKE.karPassportOnft,
      "0x1016BCA92B98Ea2C648074cAAf04C5d0B3Baf8eC",
    );
  });

  it("Nuclear #4/#5/#6 core stacks are denylisted, not active", () => {
    const hubDeny = new Set(SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()));
    const ethDeny = new Set(
      ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()),
    );
    // N4
    assert.ok(hubDeny.has("0x8354697d0ddce6a3aa9ad33ddc1585e4b60cbc76"));
    assert.ok(ethDeny.has("0x1016bca92b98ea2c648074caaf04c5d0b3baf8ec"));
    // N5 hub + Eth (never app-served)
    assert.ok(hubDeny.has("0x8542dd53345d851a320c7d1b2e78e1786743a70e"));
    assert.ok(ethDeny.has("0x2961a0fda331e1ecaf4e9f8a3515fe4346f60b2d"));
    // N6 hub + Eth (explorers red; never app-served)
    assert.ok(hubDeny.has("0x8fc3325c2d018812fcf782e3de0f0f954b3f1915"));
    assert.ok(ethDeny.has("0xfcc3fb7e926483778898f8dd38bdb1db51412a41"));
    // Still reachable via product denylist helper
    assert.ok(
      kargainContractDenylist(HUB)
        .map((a) => a.toLowerCase())
        .includes("0x8354697d0ddce6a3aa9ad33ddc1585e4b60cbc76"),
    );
  });

  it("live N7 addresses are not on their own-chain historical denylist", () => {
    const hub = requireCommercialActive(HUB);
    const eth = requireCommercialActive(ETH);
    const hubDeny = new Set(SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()));
    const ethDeny = new Set(
      ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()),
    );
    for (const addr of [
      hub.karPassport,
      hub.bridgeGateway,
      hub.fixedPriceConsignment!,
      hub.ascendingConsignment!,
      hub.timelock,
    ]) {
      assert.equal(hubDeny.has(addr.toLowerCase()), false, `hub live ${addr}`);
    }
    for (const addr of [
      eth.karPassport,
      eth.bridgeGateway,
      eth.fixedPriceConsignment!,
      eth.ascendingConsignment!,
      eth.timelock,
    ]) {
      assert.equal(ethDeny.has(addr.toLowerCase()), false, `eth live ${addr}`);
    }
  });

  it("§I.12.12 dual-list hex stays denylisted on both chains; N7 Eth live ≠ Base historical self", () => {
    const hubDeny = new Set(SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()));
    const ethDeny = new Set(
      ETHEREUM_SEPOLIA_HISTORICAL_DENYLIST.map((a) => a.toLowerCase()),
    );
    const dual = "0xc219bf834b8965339b95c0b6afe3c4d0f1266fb0";
    assert.ok(hubDeny.has(dual));
    assert.ok(ethDeny.has(dual));
    // N7 Eth Ascending hex is denylisted on Base (N3 CREATE collision) but live on Eth.
    const n7EthAscending = requireCommercialActive(ETH).ascendingConsignment!.toLowerCase();
    assert.ok(hubDeny.has(n7EthAscending));
    assert.equal(ethDeny.has(n7EthAscending), false);
  });

  it("forfeitRecipient is distinct from platformRecipient on both stacks", () => {
    const hub = requireEvmCommercialActive(HUB);
    const eth = requireEvmCommercialActive(ETH);
    assert.notEqual(hub.forfeitRecipient.toLowerCase(), hub.platformRecipient.toLowerCase());
    assert.notEqual(eth.forfeitRecipient.toLowerCase(), eth.platformRecipient.toLowerCase());
  });

  it("requireCommercialActive fails closed on unknown chain", () => {
    assert.equal(commercialActive(1), undefined);
    assert.throws(() => requireCommercialActive(1), /No COMMERCIAL_ACTIVE entry for chain 1/);
  });
});

describe("resolveCommercialStack committed fallback", () => {
  it("returns committed Eth stack matching SPEC I.9.2 Nuclear #7", () => {
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
        assert.equal(eth.karPassport, "0x1FFdEC27d14567B34548BA63269c0745227f1949");
        assert.equal(eth.indexFromBlock, 11_591_966);
        assert.equal(eth.bridgeGateway, "0x910631Df5aA4d47Ce20a6D485cd9DdC2E68D8eBc");

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
