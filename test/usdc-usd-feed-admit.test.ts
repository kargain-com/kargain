import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAINLINK_FEEDS,
  getChainFeedConfig,
  resolveUsdcUsdFeedForAdmit,
  usdcFiatUnavailableAnnouncement,
  ZERO_USDC_USD_FEED,
} from "../scripts/lib/chainlink-feeds.ts";
import { assertPaymentTokensAdmitted } from "../scripts/lib/nuclear-ordering.ts";

describe("Nuclear USDC/USD feed admit (P4 reduced capability)", () => {
  it("84532 resolves zero feed to admit + fiat limitation announcement", () => {
    const config = getChainFeedConfig(84532);
    assert.equal(config.usdcUsdFeed, ZERO_USDC_USD_FEED);
    assert.equal(config.usdcUsdStalenessTolerance, 0);
    const admit = resolveUsdcUsdFeedForAdmit(config);
    assert.equal(admit.feed, ZERO_USDC_USD_FEED);
    assert.equal(admit.stalenessTolerance, 0);
    assert.equal(admit.fiatLimitation, usdcFiatUnavailableAnnouncement(84532));
    assert.match(
      admit.fiatLimitation!,
      /Fiat-denominated sales in USDC are unavailable on chain 84532/,
    );
    assert.match(admit.fiatLimitation!, /Asset-denominated USDC sales remain available/);
    assert.match(
      admit.fiatLimitation!,
      /Timelock may later approvePaymentToken with a non-zero feed and its stalenessTolerance/,
    );
  });

  it("11155111 resolves measured feed with tolerance and no limitation", () => {
    const config = getChainFeedConfig(11155111);
    assert.notEqual(config.usdcUsdFeed, ZERO_USDC_USD_FEED);
    assert.equal(config.usdcUsdStalenessTolerance, 172_992);
    const admit = resolveUsdcUsdFeedForAdmit(config);
    assert.equal(admit.feed.toLowerCase(), config.usdcUsdFeed.toLowerCase());
    assert.equal(admit.stalenessTolerance, 172_992);
    assert.equal(admit.fiatLimitation, null);
  });

  it("resolveUsdcUsdFeedForAdmit rejects non-zero tolerance when feed is zero", () => {
    assert.throws(
      () =>
        resolveUsdcUsdFeedForAdmit({
          chainId: 84532,
          usdcUsdFeed: ZERO_USDC_USD_FEED,
          usdcUsdStalenessTolerance: 3600,
        }),
      /usdcUsdStalenessTolerance must be 0 when usdcUsdFeed is zero/,
    );
  });

  it("assertPaymentTokensAdmitted allows zero FixedPrice feed when enabled", () => {
    assert.doesNotThrow(() =>
      assertPaymentTokensAdmitted({
        fixedPriceUsdcEnabled: true,
        ascendingUsdcEnabled: true,
        usdc: CHAINLINK_FEEDS[84532].usdc,
        fixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
        expectedFixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
      }),
    );
  });

  it("assertPaymentTokensAdmitted refuses disabled token even with zero feed", () => {
    assert.throws(
      () =>
        assertPaymentTokensAdmitted({
          fixedPriceUsdcEnabled: false,
          ascendingUsdcEnabled: true,
          usdc: CHAINLINK_FEEDS[84532].usdc,
          fixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
          expectedFixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
        }),
      /FixedPrice payment token not admitted/,
    );
  });

  it("assertPaymentTokensAdmitted detects feed read-back mismatch", () => {
    assert.throws(
      () =>
        assertPaymentTokensAdmitted({
          fixedPriceUsdcEnabled: true,
          ascendingUsdcEnabled: true,
          usdc: CHAINLINK_FEEDS[84532].usdc,
          fixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
          expectedFixedPriceUsdcFeed: CHAINLINK_FEEDS[11155111].usdcUsdFeed,
        }),
      /FixedPrice USDC feed mismatch/,
    );
  });
});
