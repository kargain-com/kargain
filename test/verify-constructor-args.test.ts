import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData } from "viem";

import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
} from "../lib/contracts/abis.generated.ts";
import {
  ascendingConsignmentImplConstructorArgs,
  ascendingConsignmentProxyConstructorArgs,
  AUCTION_PLATFORM_FEE_BPS,
  DISPUTE_DEPOSIT,
  fixedPriceConsignmentImplConstructorArgs,
  fixedPriceConsignmentProxyConstructorArgs,
  karPassportBridgeGatewayConstructorArgs,
  karPassportConstructorArgs,
  karProStakingConstructorArgs,
  MARKETPLACE_FEE_BPS,
} from "../scripts/lib/verify-constructor-args.ts";
import { getChainFeedConfig, lzEndpointForChain } from "../scripts/lib/chainlink-feeds.ts";
import type { DeploymentManifest } from "../scripts/lib/load-deployment.ts";

const baseManifest: DeploymentManifest = {
  chainId: 84532,
  generation: "v2",
  karPassport: "0x2C46B2310E2cb09b0FEeDd174D9CD3870137F594",
  karProPass: "0x8e4dcb5C0b415d6c2481D72dFac6da32d9cf22C1",
  karProStaking: "0xb5d79551BB11F726D2A1A110BAc645C4345dA568",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  nativeFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1",
  timelock: "0x9319e223ff31c954A940b14F04025B56A53ED384",
  commerceGuardian: "0x3333333333333333333333333333333333333333",
  fixedPriceConsignmentImpl: "0x4444444444444444444444444444444444444444",
  ascendingConsignmentImpl: "0x5555555555555555555555555555555555555555",
  platformRecipient: "0xcfe194fea9727bD04dA8F78c2362680986e02dF1",
  deployer: "0xcf1Eb0E7ed453Ed266bF90E7C09e0E4769580b77",
  deployedAt: "2026-06-27T13:35:14.907Z",
  blocks: {},
  indexFromBlock: 43399242,
};

describe("verify constructor args", () => {
  it("builds KarPassport constructor args from manifest", () => {
    assert.deepEqual(karPassportConstructorArgs(baseManifest), [
      baseManifest.karProStaking,
      baseManifest.deployer,
      DISPUTE_DEPOSIT,
      baseManifest.platformRecipient,
    ]);
  });

  it("builds KarProStaking constructor args from manifest", () => {
    assert.deepEqual(karProStakingConstructorArgs(baseManifest), [
      baseManifest.karProPass,
      baseManifest.deployer,
    ]);
  });

  it("FixedPriceConsignment impl has empty constructor args", () => {
    assert.deepEqual(fixedPriceConsignmentImplConstructorArgs(baseManifest), []);
  });

  it("builds FixedPriceConsignment proxy constructor args with initialize calldata", () => {
    const args = fixedPriceConsignmentProxyConstructorArgs(baseManifest);
    assert.equal(args[0], baseManifest.fixedPriceConsignmentImpl);
    assert.match(String(args[1]), /^0x[a-fA-F0-9]+$/);

    const decoded = decodeFunctionData({
      abi: FixedPriceConsignmentAbi,
      data: args[1],
    });
    assert.equal(decoded.functionName, "initialize");
    assert.deepEqual(decoded.args, [
      baseManifest.karPassport,
      baseManifest.platformRecipient,
      MARKETPLACE_FEE_BPS,
      baseManifest.nativeFeed,
      getChainFeedConfig(baseManifest.chainId).nativeUsdStalenessTolerance,
      baseManifest.timelock,
      baseManifest.commerceGuardian,
    ]);
  });

  it("throws when manifest missing fixedPriceConsignmentImpl", () => {
    assert.throws(
      () =>
        fixedPriceConsignmentProxyConstructorArgs({
          ...baseManifest,
          fixedPriceConsignmentImpl: undefined,
        }),
      /fixedPriceConsignmentImpl/,
    );
  });

  it("throws when manifest missing commerceGuardian for FixedPrice proxy", () => {
    assert.throws(
      () =>
        fixedPriceConsignmentProxyConstructorArgs({
          ...baseManifest,
          commerceGuardian: undefined,
        }),
      /commerceGuardian/,
    );
  });

  it("AscendingConsignment impl has empty constructor args", () => {
    assert.deepEqual(ascendingConsignmentImplConstructorArgs(baseManifest), []);
  });

  it("builds AscendingConsignment proxy constructor args with initialize calldata", () => {
    const args = ascendingConsignmentProxyConstructorArgs(baseManifest);
    assert.equal(args[0], baseManifest.ascendingConsignmentImpl);
    assert.match(String(args[1]), /^0x[a-fA-F0-9]+$/);

    const decoded = decodeFunctionData({
      abi: AscendingConsignmentAbi,
      data: args[1],
    });
    assert.equal(decoded.functionName, "initialize");
    assert.equal(decoded.args?.[3], AUCTION_PLATFORM_FEE_BPS);
  });

  it("throws when manifest missing ascendingConsignmentImpl", () => {
    assert.throws(
      () =>
        ascendingConsignmentProxyConstructorArgs({
          ...baseManifest,
          ascendingConsignmentImpl: undefined,
        }),
      /ascendingConsignmentImpl/,
    );
  });

  it("builds KarPassportBridgeGateway args (passport, LZ, deployer) only", () => {
    const args = karPassportBridgeGatewayConstructorArgs(baseManifest);
    assert.deepEqual(args, [
      baseManifest.karPassport,
      lzEndpointForChain(84532),
      baseManifest.deployer,
    ]);
    assert.equal(args.length, 3);
  });

  it("builds KarPassportBridgeGateway args with manifest layerZeroEndpoint override", () => {
    const lz = "0x3333333333333333333333333333333333333333" as const;
    const args = karPassportBridgeGatewayConstructorArgs({
      ...baseManifest,
      layerZeroEndpoint: lz,
    });
    assert.deepEqual(args, [baseManifest.karPassport, lz, baseManifest.deployer]);
  });
});
