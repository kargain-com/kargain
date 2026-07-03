import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_MARKET_FILTERS } from "../lib/marketplace/filter-params.ts";
import {
  marketplaceListingsNeedClientRates,
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

  it("searchParamsToUrlSearchParams keeps first array value", () => {
    const sp = searchParamsToUrlSearchParams({ make: ["Toyota", "Honda"], sort: "newest" });
    assert.equal(sp.get("make"), "Toyota");
    assert.equal(sp.get("sort"), "newest");
  });
});
