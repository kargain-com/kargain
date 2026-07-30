import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAINLINK_FEEDS,
  resolveUsdcUsdFeedForAdmit,
  usdcFiatUnavailableAnnouncement,
  ZERO_USDC_USD_FEED,
} from "../scripts/lib/chainlink-feeds.ts";
import { assertPaymentTokensAdmitted } from "../scripts/lib/nuclear-ordering.ts";

describe("Nuclear USDC/USD feed admit (P4 reduced capability)", () => {
  it("84532 resolves zero feed to admit + fiat limitation announcement", () => {
    const feed = CHAINLINK_FEEDS[84532].usdcUsdFeed;
    assert.equal(feed, ZERO_USDC_USD_FEED);
    const admit = resolveUsdcUsdFeedForAdmit(feed, 84532);
    assert.equal(admit.feed, ZERO_USDC_USD_FEED);
    assert.equal(admit.fiatLimitation, usdcFiatUnavailableAnnouncement(84532));
    assert.match(
      admit.fiatLimitation!,
      /Fiat-denominated sales in USDC are unavailable on chain 84532/,
    );
    assert.match(admit.fiatLimitation!, /Asset-denominated USDC sales remain available/);
    assert.match(
      admit.fiatLimitation!,
      /Timelock may later approvePaymentToken with a non-zero feed; once set, the feed cannot be cleared/,
    );
  });

  it("11155111 resolves measured feed with no limitation", () => {
    const feed = CHAINLINK_FEEDS[11155111].usdcUsdFeed;
    assert.notEqual(feed, ZERO_USDC_USD_FEED);
    const admit = resolveUsdcUsdFeedForAdmit(feed, 11155111);
    assert.equal(admit.feed.toLowerCase(), feed.toLowerCase());
    assert.equal(admit.fiatLimitation, null);
  });

  it("assertPaymentTokensAdmitted allows zero FixedPrice feed when enabled", () => {
    assert.doesNotThrow(() =>
      assertPaymentTokensAdmitted({
        fixedPriceUsdcEnabled: true,
        ascendingUsdcEnabled: true,
        usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
          usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
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
          usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          fixedPriceUsdcFeed: ZERO_USDC_USD_FEED,
          expectedFixedPriceUsdcFeed: "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E",
        }),
      /FixedPrice USDC feed mismatch/,
    );
  });
});
