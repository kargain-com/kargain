/**
 * Browse filter semantics — owned by `lib/marketplace/consignment-browse-filters.ts`
 * (+ SQL assembly in `src/lib/ponder-consignment-browse.ts`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseConsignmentBrowseFilters,
  resolveFilterBoundsUsd1e8,
  splitCsvFilter,
} from "../lib/marketplace/consignment-browse-filters.ts";
import {
  normalizeListingFiatCurrency,
  parseFxRatesFromQuery,
} from "../lib/marketplace/price-normalize.ts";

const ETH_USD = 300_000_000_000n;
const EUR_USD = 108_000_000n;
const CNY_USD = 14_000_000n;
const KRW_USD = 64_495n;
const AED_USD = 27_229_408n;

describe("parseConsignmentBrowseFilters", () => {
  it("parses CSV multi-select keys and sort/status defaults", () => {
    const f = parseConsignmentBrowseFilters({
      fuelType: "Petrol,Diesel",
      bodyType: "Sedan",
      sort: "price_asc",
      status: "VERIFIED",
      verifiedFirst: "true",
    });
    assert.deepEqual(f.fuelTypes, ["Petrol", "Diesel"]);
    assert.deepEqual(f.bodyTypes, ["Sedan"]);
    assert.equal(f.sort, "price_asc");
    assert.equal(f.status, "VERIFIED");
    assert.equal(f.verifiedFirst, true);
  });

  it("defaults verifiedFirst to false when absent", () => {
    const f = parseConsignmentBrowseFilters({});
    assert.equal(f.verifiedFirst, false);
    assert.equal(f.sort, "newest");
    assert.equal(f.status, "all");
  });
});

describe("splitCsvFilter", () => {
  it("splits and trims", () => {
    assert.deepEqual(splitCsvFilter("Petrol, Diesel"), ["Petrol", "Diesel"]);
    assert.deepEqual(splitCsvFilter(""), []);
    assert.deepEqual(splitCsvFilter(undefined), []);
  });
});

describe("resolveFilterBoundsUsd1e8", () => {
  it("converts USD bounds without rates", () => {
    const bounds = resolveFilterBoundsUsd1e8(
      { priceCurrency: "USD", priceMin: "100", priceMax: "200" },
      null,
    );
    assert.ok(bounds);
    assert.equal(bounds!.min, 10_000_000_000n);
    assert.equal(bounds!.max, 20_000_000_000n);
  });

  it("converts ETH min using Chainlink rate", () => {
    const rates = parseFxRatesFromQuery({
      ethUsdRate: String(ETH_USD),
      eurUsdRate: String(EUR_USD),
    });
    const min4 = resolveFilterBoundsUsd1e8(
      { priceCurrency: "ETH", priceMin: "4", ethUsdRate: String(ETH_USD) },
      rates,
    );
    assert.ok(min4?.min != null);
    const min20 = resolveFilterBoundsUsd1e8(
      { priceCurrency: "ETH", priceMin: "20", ethUsdRate: String(ETH_USD) },
      rates,
    );
    assert.ok(min20?.min != null);
    assert.ok(min20!.min! > min4!.min!);
  });

  it("fail-closes EUR bounds when rates unavailable", () => {
    assert.equal(
      resolveFilterBoundsUsd1e8({ priceCurrency: "EUR", priceMin: "200000" }, null),
      null,
    );
  });

  it("converts CNY / KRW / AED with rates", () => {
    const cny = resolveFilterBoundsUsd1e8(
      {
        priceCurrency: "CNY",
        priceMin: "500",
        priceMax: "2000",
        cnyUsdRate: String(CNY_USD),
      },
      parseFxRatesFromQuery({ cnyUsdRate: String(CNY_USD) }),
    );
    assert.ok(cny?.min != null && cny.max != null);

    const krw = resolveFilterBoundsUsd1e8(
      {
        priceCurrency: "KRW",
        priceMin: "100000",
        priceMax: "500000",
        krwUsdRate: String(KRW_USD),
      },
      parseFxRatesFromQuery({ krwUsdRate: String(KRW_USD) }),
    );
    assert.ok(krw?.min != null);

    const aedOk = resolveFilterBoundsUsd1e8(
      {
        priceCurrency: "AED",
        priceMin: "400",
        priceMax: "700",
        aedUsdRate: String(AED_USD),
      },
      parseFxRatesFromQuery({ aedUsdRate: String(AED_USD) }),
    );
    assert.ok(aedOk?.min != null);
  });

  it("returns undefined when no price bounds", () => {
    assert.equal(resolveFilterBoundsUsd1e8({}, null), undefined);
  });

  it("fail-closes when ETH rate missing", () => {
    assert.equal(
      resolveFilterBoundsUsd1e8({ priceCurrency: "ETH", priceMin: "1" }, null),
      null,
    );
  });
});

describe("normalizeListingFiatCurrency", () => {
  it("coerces API values to legacy enum 0–10", () => {
    assert.equal(normalizeListingFiatCurrency(0), 0);
    assert.equal(normalizeListingFiatCurrency(1), 1);
    assert.equal(normalizeListingFiatCurrency(10), 10);
    assert.equal(normalizeListingFiatCurrency("0"), 0);
    assert.equal(normalizeListingFiatCurrency("1"), 1);
    assert.equal(normalizeListingFiatCurrency(99), 0);
  });
});
