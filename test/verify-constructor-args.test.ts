import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  karPassportConstructorArgs,
  marketplaceImplConstructorArgs,
  marketplaceProxyConstructorArgs,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
  MARKETPLACE_PRO_FEE_BPS,
} from "../scripts/lib/verify-constructor-args.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";

const manifest: DeploymentManifest = {
  chainId: 84532,
  generation: "v1.1",
  karPassport: "0x6378469256907D7DC14BBfce0261ceDE22314507",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
  marketplace: "0x4FC74e0B7eE0A741707A553D43Efff68126D198B",
  marketplaceImpl: "0x7d37e7cbcc42308264B608429a82D03B7C3112F4",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  eurFeed: "0xb49f677943BC038e9857d61E7d053CaA2C1734C1",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  deployedAt: "2026-06-14T09:20:13.857Z",
  blocks: {},
  indexFromBlock: 42830248,
};

describe("verify constructor args", () => {
  it("builds KarPassport constructor args from manifest", () => {
    assert.deepEqual(karPassportConstructorArgs(manifest), [
      "0x2794015C00Da0FAf5D2451Ffba9FdD30F86dBC31",
    ]);
  });

  it("builds MarketplaceEscrow impl constructor args from manifest", () => {
    const args = marketplaceImplConstructorArgs(manifest);
    assert.equal(args[0], manifest.karPassport);
    assert.equal(args[1], manifest.usdc);
    assert.equal(args[4], manifest.karProStaking);
    assert.equal(args[6], MARKETPLACE_FEE_BPS);
    assert.equal(args[7], MARKETPLACE_PRO_FEE_BPS);
    assert.equal(args[8], MARKETPLACE_MAX_FEED_STALENESS);
  });

  it("builds proxy constructor args with initialize calldata", () => {
    const args = marketplaceProxyConstructorArgs(manifest);
    assert.equal(args[0], manifest.marketplaceImpl);
    assert.match(String(args[1]), /^0x[a-fA-F0-9]+$/);
    assert.ok(String(args[1]).length > 10);
  });
});
