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
import { assertNuclearEncumbranceOrdering } from "../scripts/lib/nuclear-ordering.ts";
import {
  AUCTION_PLATFORM_FEE_BPS,
  DISPUTE_DEPOSIT,
  MARKETPLACE_FEE_BPS,
  MARKETPLACE_MAX_FEED_STALENESS,
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
    assert.equal(base.params.maxFeedStaleness, MARKETPLACE_MAX_FEED_STALENESS);
    assert.equal(base.params.auctionPlatformFeeBps, AUCTION_PLATFORM_FEE_BPS);
    assert.equal(base.params.platformRecipient, eth.params.platformRecipient);
  });

  it("step list includes modes + encumbrance + admit before gateway, then mode handoff then ownership handoff (no escrow steps)", () => {
    assertNuclearEncumbranceOrdering(base.steps);
    assert.deepEqual([...base.steps], [...NUCLEAR_DEPLOY_STEPS]);
    const fixedImplIdx = base.steps.indexOf("FixedPriceConsignmentImpl");
    const fixedIdx = base.steps.indexOf("FixedPriceConsignmentProxy");
    const ascendingImplIdx = base.steps.indexOf("AscendingConsignmentImpl");
    const ascendingIdx = base.steps.indexOf("AscendingConsignmentProxy");
    const encFixedIdx = base.steps.indexOf("addEncumbranceSourceFixedPrice");
    const encAscIdx = base.steps.indexOf("addEncumbranceSourceAscending");
    const admitFixedIdx = base.steps.indexOf("approvePaymentTokenFixedPrice");
    const admitAscIdx = base.steps.indexOf("approvePaymentTokenAscending");
    const gatewayIdx = base.steps.indexOf("KarPassportBridgeGateway");
    const bindIdx = base.steps.indexOf("setBridgeGateway");
    const fpOwnIdx = base.steps.indexOf("transferFixedPriceOwnership");
    const ascOwnIdx = base.steps.indexOf("transferAscendingOwnership");
    const passportOwnIdx = base.steps.indexOf("transferPassportOwnership");
    const stakingOwnIdx = base.steps.indexOf("transferStakingOwnership");
    assert.ok(fixedIdx === fixedImplIdx + 1 && ascendingImplIdx === fixedIdx + 1);
    assert.ok(ascendingIdx === ascendingImplIdx + 1);
    assert.ok(encFixedIdx === ascendingIdx + 1 && encAscIdx === encFixedIdx + 1);
    assert.ok(admitFixedIdx === encAscIdx + 1 && admitAscIdx === admitFixedIdx + 1);
    assert.ok(gatewayIdx === admitAscIdx + 1 && bindIdx === gatewayIdx + 1);
    assert.ok(fpOwnIdx === bindIdx + 1 && ascOwnIdx === fpOwnIdx + 1);
    assert.ok(passportOwnIdx === ascOwnIdx + 1 && stakingOwnIdx === passportOwnIdx + 1);
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
      base.externals.usdcUsdFeed.toLowerCase(),
      CHAINLINK_FEEDS[84532].usdcUsdFeed.toLowerCase(),
    );
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
      eth.externals.usdcUsdFeed.toLowerCase(),
      CHAINLINK_FEEDS[11155111].usdcUsdFeed.toLowerCase(),
    );
    assert.equal(
      eth.externals.nativeUsdFeed.toLowerCase(),
      CHAINLINK_FEEDS[11155111].nativeUsdFeed.toLowerCase(),
    );
    assert.equal(
      eth.externals.layerZeroEndpoint.toLowerCase(),
      LZ_ENDPOINT_V2_BY_CHAIN[11155111].toLowerCase(),
    );

    assert.notEqual(base.externals.usdc.toLowerCase(), eth.externals.usdc.toLowerCase());
    // 84532 has no USDC/USD feed; Eth Sepolia does — FixedPrice admit refuse vs OK.
    assert.equal(
      base.externals.usdcUsdFeed,
      "0x0000000000000000000000000000000000000000",
    );
    assert.notEqual(
      eth.externals.usdcUsdFeed,
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("parity table reports identical shared parameters", () => {
    const table = formatNuclearParityTable(base, eth);
    assert.match(table, /84532 vs 11155111 parameters identical/);
    assert.match(table, /usd-only/);
    console.log("\n" + table);
  });
});
