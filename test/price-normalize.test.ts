import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayAmountToUsd1e8,
  fiatUsdRate,
  FIAT_SCALE,
  listingToUsd1e8,
  ratesReadyForPriceCurrency,
  usd1e8ToFiat1e8,
} from "../lib/marketplace/price-normalize.ts";

const EUR_USD = 108_000_000n;
const CNY_USD = 14_000_000n;
const KRW_USD = 64_495n;
const AED_LIVE = 27_229_408n;
const BTC_USD = 7_000_000_000_000n;
const rates = {
  ethUsd: 300_000_000_000n,
  eurUsd: EUR_USD,
  cnyUsd: CNY_USD,
  inrUsd: 12_000_000n,
  brlUsd: 20_000_000n,
  idrUsd: 6_000n,
  audUsd: 65_000_000n,
  aedUsd: AED_LIVE,
};

describe("fiatUsdRate", () => {
  it("returns identity scale for USD", () => {
    assert.equal(fiatUsdRate("USD", null), FIAT_SCALE);
  });

  it("returns null for AED when live rate absent", () => {
    assert.equal(fiatUsdRate("AED", null), null);
  });

  it("returns live AED rate when present", () => {
    assert.equal(fiatUsdRate("AED", { aedUsd: AED_LIVE }), AED_LIVE);
  });

  it("returns null for live fiats when rates missing", () => {
    assert.equal(fiatUsdRate("CNY", null), null);
    assert.equal(fiatUsdRate("EUR", { eurUsd: EUR_USD }), EUR_USD);
  });
});

describe("listingToUsd1e8", () => {
  it("converts EUR listing to USD", () => {
    const usd = listingToUsd1e8(100_000_000_000n, 1, rates);
    assert.equal(usd, (100_000_000_000n * EUR_USD) / FIAT_SCALE);
  });

  it("returns listing amount unchanged for USD", () => {
    assert.equal(listingToUsd1e8(50_000_000_000n, 0, null), 50_000_000_000n);
  });

  it("returns null for EUR listing when eurUsd missing", () => {
    assert.equal(listingToUsd1e8(100_000_000_000n, 1, null), null);
  });
});

describe("usd1e8ToFiat1e8", () => {
  it("converts USD to CNY display amount", () => {
    const cny = usd1e8ToFiat1e8(100_000_000_000n, "CNY", rates);
    assert.equal(cny, (100_000_000_000n * FIAT_SCALE) / CNY_USD);
  });

  it("converts USD to AED using live rate when available", () => {
    const aed = usd1e8ToFiat1e8(100_000_000_000n, "AED", { aedUsd: AED_LIVE });
    assert.equal(aed, (100_000_000_000n * FIAT_SCALE) / AED_LIVE);
  });

  it("returns null for AED when live rate absent", () => {
    assert.equal(usd1e8ToFiat1e8(100_000_000_000n, "AED", null), null);
  });
});

describe("displayAmountToUsd1e8", () => {
  it("converts CNY filter input to USD", () => {
    const usd = displayAmountToUsd1e8("100", "CNY", rates);
    assert.equal(usd, (100n * CNY_USD));
  });

  it("returns undefined for AED when live rate absent", () => {
    assert.equal(displayAmountToUsd1e8("100", "AED", null), undefined);
  });

  it("converts AED filter input using live rate when present", () => {
    const usd = displayAmountToUsd1e8("100", "AED", { aedUsd: AED_LIVE });
    assert.equal(usd, 100n * AED_LIVE);
  });

  it("returns undefined for EUR when rates missing", () => {
    assert.equal(displayAmountToUsd1e8("100", "EUR", null), undefined);
  });

  it("converts BTC filter input to USD", () => {
    const usd = displayAmountToUsd1e8("1", "BTC", { btcUsd: BTC_USD });
    assert.equal(usd, BTC_USD);
  });

  it("converts KRW filter input to USD", () => {
    const usd = displayAmountToUsd1e8("1000000", "KRW", { krwUsd: KRW_USD });
    assert.equal(usd, (1_000_000n * KRW_USD));
  });
});

describe("ratesReadyForPriceCurrency", () => {
  it("requires btcUsd for BTC display filter", () => {
    assert.equal(ratesReadyForPriceCurrency("BTC", null), false);
    assert.equal(ratesReadyForPriceCurrency("BTC", { btcUsd: BTC_USD }), true);
  });

  it("requires aedUsd for AED display filter", () => {
    assert.equal(ratesReadyForPriceCurrency("AED", null), false);
    assert.equal(ratesReadyForPriceCurrency("AED", { aedUsd: AED_LIVE }), true);
  });
});
