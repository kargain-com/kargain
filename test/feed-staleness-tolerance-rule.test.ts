import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAINLINK_FEEDS,
  deriveFeedStalenessTolerance,
  FEED_STALENESS_MULTIPLIER,
  MAX_FEED_STALENESS,
  MIN_FEED_STALENESS,
} from "../scripts/lib/chainlink-feeds.ts";

describe("P4 feed staleness tolerance rule", () => {
  it("uses a single multiplier of 2", () => {
    assert.equal(FEED_STALENESS_MULTIPLIER, 2);
  });

  it("takes the greater of observed max and published heartbeat, then multiplies", () => {
    // obs governs
    assert.equal(deriveFeedStalenessTolerance(1222, 1200), 2444);
    // hb governs
    assert.equal(deriveFeedStalenessTolerance(1000, 3600), 7200);
  });

  it("matches committed Nuclear / mainnet config rows (2026-07-30 probe + directory)", () => {
    // 84532 ETH/USD — obs 1222, hb 1200
    assert.equal(CHAINLINK_FEEDS[84532].nativeUsdStalenessTolerance, deriveFeedStalenessTolerance(1222, 1200));
    assert.equal(CHAINLINK_FEEDS[84532].usdcUsdStalenessTolerance, 0);

    // 11155111 ETH/USD — obs 3696, hb 3600; USDC — obs 86496, hb 86400
    assert.equal(CHAINLINK_FEEDS[11155111].nativeUsdStalenessTolerance, deriveFeedStalenessTolerance(3696, 3600));
    assert.equal(CHAINLINK_FEEDS[11155111].usdcUsdStalenessTolerance, deriveFeedStalenessTolerance(86496, 86400));

    // Mainnet config (not Nuclear)
    assert.equal(CHAINLINK_FEEDS[8453].nativeUsdStalenessTolerance, deriveFeedStalenessTolerance(1230, 1200));
    assert.equal(CHAINLINK_FEEDS[8453].usdcUsdStalenessTolerance, deriveFeedStalenessTolerance(86434, 86400));
    assert.equal(CHAINLINK_FEEDS[1].nativeUsdStalenessTolerance, deriveFeedStalenessTolerance(3660, 3600));
    assert.equal(CHAINLINK_FEEDS[1].usdcUsdStalenessTolerance, deriveFeedStalenessTolerance(82848, 82800));
  });

  it("keeps every non-zero committed tolerance inside governance bounds", () => {
    for (const config of Object.values(CHAINLINK_FEEDS)) {
      if (config.nativeUsdStalenessTolerance !== 0) {
        assert.ok(config.nativeUsdStalenessTolerance >= MIN_FEED_STALENESS);
        assert.ok(config.nativeUsdStalenessTolerance <= MAX_FEED_STALENESS);
      }
      if (config.usdcUsdStalenessTolerance !== 0) {
        assert.ok(config.usdcUsdStalenessTolerance >= MIN_FEED_STALENESS);
        assert.ok(config.usdcUsdStalenessTolerance <= MAX_FEED_STALENESS);
      }
      for (const c of config.currencies) {
        if (c.stalenessTolerance === 0) continue;
        assert.ok(c.stalenessTolerance >= MIN_FEED_STALENESS);
        assert.ok(c.stalenessTolerance <= MAX_FEED_STALENESS);
      }
    }
  });

  it("governance MAX is 72h so 2× daily heartbeats with obs overshoot fit without hand-clamp", () => {
    assert.equal(MAX_FEED_STALENESS, 259_200);
    // Prior 48h bound would reject Sepolia USDC under the rule:
    assert.ok(deriveFeedStalenessTolerance(86496, 86400) > 172_800);
    assert.ok(deriveFeedStalenessTolerance(86496, 86400) <= MAX_FEED_STALENESS);
  });
});
