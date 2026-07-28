import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAINLINK_FEEDS,
  LZ_ENDPOINT_V2_BY_CHAIN,
} from "../scripts/lib/chainlink-feeds.ts";
import {
  assertNuclearParamParity,
  buildNuclearDeployPlan,
  externalsMatchTables,
  formatNuclearParityTable,
  NUCLEAR_DEPLOY_STEPS,
} from "../scripts/lib/nuclear-deploy-plan.ts";
import {
  AUCTION_PLATFORM_FEE_BPS,
  DISPUTE_DEPOSIT,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
  MARKETPLACE_PRO_FEE_BPS,
} from "../scripts/lib/verify-constructor-args.ts";

describe("nuclear deploy plan", () => {
  const base = buildNuclearDeployPlan(84532);
  const eth = buildNuclearDeployPlan(11155111);

  it("rejects non-commercial chainIds", () => {
    assert.throws(() => buildNuclearDeployPlan(31337), /84532\|11155111/);
  });

  it("84532 vs 11155111 shared params are identical", () => {
    assertNuclearParamParity(base, eth);
    assert.equal(base.registry, "usd-only");
    assert.equal(eth.registry, "usd-only");
    assert.equal(base.params.disputeDeposit, DISPUTE_DEPOSIT);
    assert.equal(base.params.marketplaceFeeBps, MARKETPLACE_FEE_BPS);
    assert.equal(base.params.marketplaceProFeeBps, MARKETPLACE_PRO_FEE_BPS);
    assert.equal(base.params.maxFeedStaleness, MARKETPLACE_MAX_FEED_STALENESS);
    assert.equal(base.params.auctionPlatformFeeBps, AUCTION_PLATFORM_FEE_BPS);
    assert.equal(base.params.platformRecipient, eth.params.platformRecipient);
  });

  it("step list includes Auction then Gateway then setBridgeGateway", () => {
    assert.deepEqual([...base.steps], [...NUCLEAR_DEPLOY_STEPS]);
    const auctionIdx = base.steps.indexOf("AuctionEscrowProxy");
    const gatewayIdx = base.steps.indexOf("KarPassportBridgeGateway");
    const bindIdx = base.steps.indexOf("setBridgeGateway");
    assert.ok(auctionIdx >= 0 && gatewayIdx > auctionIdx && bindIdx === gatewayIdx + 1);
  });

  it("tokenIdOffset is chainId << 128", () => {
    assert.equal(base.tokenIdOffset, BigInt(84532) << 128n);
    assert.equal(eth.tokenIdOffset, BigInt(11155111) << 128n);
  });

  it("externals match CHAINLINK_FEEDS / LZ_ENDPOINT_V2_BY_CHAIN only", () => {
    assert.ok(externalsMatchTables(base));
    assert.ok(externalsMatchTables(eth));

    assert.equal(base.externals.usdc.toLowerCase(), CHAINLINK_FEEDS[84532].usdc.toLowerCase());
    assert.equal(
      base.externals.nativeUsdFeed.toLowerCase(),
      CHAINLINK_FEEDS[84532].nativeUsdFeed.toLowerCase(),
    );
    assert.equal(
      base.externals.layerZeroEndpoint.toLowerCase(),
      LZ_ENDPOINT_V2_BY_CHAIN[84532].toLowerCase(),
    );

    assert.equal(eth.externals.usdc.toLowerCase(), CHAINLINK_FEEDS[11155111].usdc.toLowerCase());
    assert.equal(
      eth.externals.nativeUsdFeed.toLowerCase(),
      CHAINLINK_FEEDS[11155111].nativeUsdFeed.toLowerCase(),
    );
    assert.equal(
      eth.externals.layerZeroEndpoint.toLowerCase(),
      LZ_ENDPOINT_V2_BY_CHAIN[11155111].toLowerCase(),
    );

    assert.notEqual(base.externals.usdc.toLowerCase(), eth.externals.usdc.toLowerCase());
  });

  it("parity table reports identical shared parameters", () => {
    const table = formatNuclearParityTable(base, eth);
    assert.match(table, /84532 vs 11155111 parameters identical/);
    assert.match(table, /usd-only/);
    console.log("\n" + table);
  });
});
