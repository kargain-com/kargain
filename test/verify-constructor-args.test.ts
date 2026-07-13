import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUCTION_PLATFORM_FEE_BPS,
  auctionEscrowImplConstructorArgs,
  auctionEscrowProxyConstructorArgs,
  DISPUTE_DEPOSIT,
  karPassportConstructorArgs,
  karProStakingConstructorArgs,
  marketplaceImplConstructorArgs,
  marketplaceProxyConstructorArgs,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
  MARKETPLACE_PRO_FEE_BPS,
} from "../scripts/lib/verify-constructor-args.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";

const manifest: DeploymentManifest = {
  chainId: 84532,
  generation: "v2",
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  marketplace: "0x9411Af4C4Ec26D939fb1AD04362456Cb41616c19",
  marketplaceImpl: "0x58d5e740B29Ab549fBD4d0A147fcDedc32E0b6a3",
  auctionEscrow: "0x1111111111111111111111111111111111111111",
  auctionEscrowImpl: "0x2222222222222222222222222222222222222222",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  deployedAt: "2026-06-27T13:35:14.907Z",
  blocks: {},
  indexFromBlock: 43399242,
};

describe("verify constructor args", () => {
  it("builds KarPassport constructor args from manifest", () => {
    assert.deepEqual(karPassportConstructorArgs(manifest), [
      manifest.karProStaking,
      manifest.deployer,
      DISPUTE_DEPOSIT,
    ]);
  });

  it("builds KarProStaking constructor args from manifest", () => {
    assert.deepEqual(karProStakingConstructorArgs(manifest), [
      manifest.karProPass,
      manifest.deployer,
    ]);
  });

  it("builds MarketplaceEscrow impl constructor args from manifest", () => {
    const args = marketplaceImplConstructorArgs(manifest);
    assert.equal(args[0], manifest.karPassport);
    assert.equal(args[1], manifest.usdc);
    assert.equal(args[3], manifest.karProStaking);
    assert.equal(args[5], MARKETPLACE_FEE_BPS);
    assert.equal(args[6], MARKETPLACE_PRO_FEE_BPS);
    assert.equal(args[7], MARKETPLACE_MAX_FEED_STALENESS);
  });

  it("builds proxy constructor args with initialize calldata", () => {
    const args = marketplaceProxyConstructorArgs(manifest);
    assert.equal(args[0], manifest.marketplaceImpl);
    assert.match(String(args[1]), /^0x[a-fA-F0-9]+$/);
    assert.ok(String(args[1]).length > 10);
  });

  it("builds AuctionEscrow impl constructor args from manifest", () => {
    const args = auctionEscrowImplConstructorArgs(manifest);
    assert.equal(args[0], manifest.karPassport);
    assert.equal(args[1], manifest.usdc);
    assert.equal(args[3], manifest.karProStaking);
    assert.equal(args[4], manifest.platformRecipient);
    assert.equal(args[5], AUCTION_PLATFORM_FEE_BPS);
  });

  it("builds AuctionEscrow proxy constructor args with initialize calldata", () => {
    const args = auctionEscrowProxyConstructorArgs(manifest);
    assert.equal(args[0], manifest.auctionEscrowImpl);
    assert.match(String(args[1]), /^0x[a-fA-F0-9]+$/);
    assert.ok(String(args[1]).length > 10);
  });
});
