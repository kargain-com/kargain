import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_MARKET_FILTERS } from "../lib/marketplace/filter-params.ts";
import {
  marketplaceListingsNeedClientRates,
  marketplaceListingsRatesReady,
  marketplaceListingsShouldForwardRates,
  searchParamsToUrlSearchParams,
} from "../lib/marketplace/listings-prefetch.ts";

describe("listings-prefetch", () => {
  it("default browse does not need client rates", () => {
    assert.equal(marketplaceListingsNeedClientRates(DEFAULT_MARKET_FILTERS), false);
  });

  it("USD price filter does not need client rates", () => {
    assert.equal(
      marketplaceListingsNeedClientRates({
        ...DEFAULT_MARKET_FILTERS,
        priceMin: "10000",
        priceCurrency: "USD",
      }),
      false,
    );
  });

  it("USD price filter still forwards rates when the client has them", () => {
    assert.equal(
      marketplaceListingsShouldForwardRates({
        ...DEFAULT_MARKET_FILTERS,
        priceMin: "10000",
        priceCurrency: "USD",
      }),
      true,
    );
  });

  it("EUR price filter needs client rates", () => {
    assert.equal(
      marketplaceListingsNeedClientRates({
        ...DEFAULT_MARKET_FILTERS,
        priceMin: "10000",
        priceCurrency: "EUR",
      }),
      true,
    );
  });

  it("price sort needs client rates", () => {
    assert.equal(
      marketplaceListingsNeedClientRates({
        ...DEFAULT_MARKET_FILTERS,
        sort: "price_asc",
      }),
      true,
    );
  });

  it("make filter without price sort does not need client rates", () => {
    assert.equal(
      marketplaceListingsNeedClientRates({
        ...DEFAULT_MARKET_FILTERS,
        make: "Toyota",
      }),
      false,
    );
  });

  it("rates ready when client rates not required", () => {
    assert.equal(marketplaceListingsRatesReady(DEFAULT_MARKET_FILTERS, null), true);
  });

  it("price sort not ready until eth and eur rates load", () => {
    const filters = { ...DEFAULT_MARKET_FILTERS, sort: "price_asc" as const };
    assert.equal(marketplaceListingsRatesReady(filters, null), false);
    assert.equal(
      marketplaceListingsRatesReady(filters, { ethUsd: 1n, eurUsd: 1n }),
      true,
    );
  });

  it("EUR price filter not ready until eur rate loads", () => {
    const filters = {
      ...DEFAULT_MARKET_FILTERS,
      priceMin: "10000",
      priceCurrency: "EUR" as const,
    };
    assert.equal(marketplaceListingsRatesReady(filters, null), false);
    assert.equal(marketplaceListingsRatesReady(filters, { eurUsd: 1n }), true);
  });

  it("searchParamsToUrlSearchParams keeps first array value", () => {
    const sp = searchParamsToUrlSearchParams({ make: ["Toyota", "Honda"], sort: "newest" });
    assert.equal(sp.get("make"), "Toyota");
    assert.equal(sp.get("sort"), "newest");
  });
});
