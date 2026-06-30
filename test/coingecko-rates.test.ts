import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCoinGeckoExchangeRates,
  parseCoinGeckoRates,
} from "../lib/marketplace/coingecko-rates.ts";
import { FIAT_SCALE } from "../lib/marketplace/price-normalize.ts";

describe("parseCoinGeckoRates", () => {
  it("parses ETH/USD and derives EUR/USD via ETH cross", () => {
    const result = parseCoinGeckoRates({
      ethereum: { usd: 3000, eur: 2777.78 },
    });
    assert.ok(result.ethUsd != null && result.ethUsd > 0n);
    assert.ok(result.eurUsd != null && result.eurUsd > 0n);
    assert.equal(result.ethUsd, 300_000_000_000n);
  });

  it("returns null rates when ethereum missing", () => {
    assert.deepEqual(parseCoinGeckoRates({}), { ethUsd: null, eurUsd: null });
  });
});

describe("parseCoinGeckoExchangeRates", () => {
  it("derives USD-per-unit rates from BTC-denominated exchange_rates", () => {
    const result = parseCoinGeckoExchangeRates({
      rates: {
        usd: { value: 70000 },
        cny: { value: 500000 },
        inr: { value: 5800000 },
        brl: { value: 350000 },
        idr: { value: 1100000000 },
        aud: { value: 105000 },
        aed: { value: 257000 },
      },
    });

    assert.ok(result.cnyUsd != null);

    const expectedCny = BigInt(Math.round((70000 / 500000) * Number(FIAT_SCALE)));
    assert.equal(result.cnyUsd, expectedCny);

    assert.ok(result.inrUsd != null);
    assert.ok(result.brlUsd != null);
    assert.ok(result.idrUsd != null);
    assert.ok(result.audUsd != null);
    assert.ok(result.aedUsd != null);
    const expectedAed = BigInt(Math.round((70000 / 257000) * Number(FIAT_SCALE)));
    assert.equal(result.aedUsd, expectedAed);
  });

  it("returns null aedUsd when aed missing from exchange_rates", () => {
    const result = parseCoinGeckoExchangeRates({
      rates: {
        usd: { value: 70000 },
        cny: { value: 500000 },
      },
    });
    assert.equal(result.cnyUsd != null, true);
    assert.equal(result.aedUsd, null);
  });

  it("returns null fields when USD rate missing", () => {
    assert.deepEqual(parseCoinGeckoExchangeRates({ rates: { cny: { value: 500000 } } }), {
      cnyUsd: null,
      inrUsd: null,
      brlUsd: null,
      idrUsd: null,
      audUsd: null,
      aedUsd: null,
    });
  });
});
