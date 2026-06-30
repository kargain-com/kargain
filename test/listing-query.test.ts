import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeListingFacets,
  isDefaultListingsBrowse,
  matchesListingFilters,
  sortEnrichedListings,
  type EnrichedListingForFilter,
} from "../lib/marketplace/listing-query.ts";
import { normalizeListingFiatCurrency } from "../lib/marketplace/price-normalize.ts";

const baseRow: EnrichedListingForFilter = {
  passportStatus: "VERIFIED",
  vin: "1HGCM82633A123456",
  make: "Honda",
  model: "Civic",
  year: 2021,
  mileageKm: 45000,
  fuelType: "Petrol",
  bodyType: "Sedan",
  transmission: "Manual",
  fiatPrice1e8: 15_000_000_000n,
  fiatCurrency: 0,
  listedAt: 100n,
};

const ETH_USD = 300_000_000_000n;
const EUR_USD = 108_000_000n;
const CNY_USD = 14_000_000n;
const KRW_USD = 64_495n;

describe("matchesListingFilters", () => {
  it("matches fuel, body, and transmission csv filters", () => {
    assert.equal(
      matchesListingFilters(baseRow, { fuelTypes: ["Petrol", "Diesel"] }),
      true,
    );
    assert.equal(
      matchesListingFilters(baseRow, { fuelTypes: ["Electric"] }),
      false,
    );
    assert.equal(
      matchesListingFilters(baseRow, { bodyTypes: ["Sedan"], transmissions: ["Manual"] }),
      true,
    );
  });

  it("filters by USD price bounds without rates", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "USD",
        priceMin: "100",
        priceMax: "200",
      }),
      true,
    );
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "USD",
        priceMin: "200",
      }),
      false,
    );
  });

  it("filters ETH min against USD listing using Chainlink rate", () => {
    const usdListing: EnrichedListingForFilter = {
      ...baseRow,
      fiatPrice1e8: 4_500_000_000_000n,
      fiatCurrency: 0,
    };
    const rates = { ethUsd: ETH_USD, eurUsd: EUR_USD };

    assert.equal(
      matchesListingFilters(usdListing, {
        priceCurrency: "ETH",
        priceMin: "4",
        ethUsdRate: String(rates.ethUsd),
        eurUsdRate: String(rates.eurUsd),
      }),
      true,
    );
    assert.equal(
      matchesListingFilters(usdListing, {
        priceCurrency: "ETH",
        priceMin: "20",
        ethUsdRate: String(rates.ethUsd),
        eurUsdRate: String(rates.eurUsd),
      }),
      false,
    );
  });

  it("excludes EUR listings from USD price filter when rates unavailable", () => {
    const eurListing: EnrichedListingForFilter = {
      ...baseRow,
      fiatPrice1e8: 15_000_000_000_000n,
      fiatCurrency: 1,
    };
    assert.equal(
      matchesListingFilters(eurListing, {
        priceCurrency: "USD",
        priceMin: "100",
        priceMax: "200000",
      }),
      false,
    );
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "USD",
        priceMin: "100",
        priceMax: "200000",
      }),
      true,
    );
  });

  it("skips EUR price filter when rates unavailable", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "EUR",
        priceMin: "200000",
      }),
      true,
    );
  });

  it("filters by CNY price bounds with cnyUsd rate", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "CNY",
        priceMin: "500",
        priceMax: "2000",
        cnyUsdRate: String(CNY_USD),
      }),
      true,
    );
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "CNY",
        priceMin: "2000",
        cnyUsdRate: String(CNY_USD),
      }),
      false,
    );
  });

  it("filters by KRW price bounds with krwUsd rate", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        priceCurrency: "KRW",
        priceMin: "100000",
        priceMax: "500000",
        krwUsdRate: String(KRW_USD),
      }),
      true,
    );
  });

  it("filters by make, model, year, mileage, and status", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        make: "Honda",
        model: "Civic",
        yearMin: 2020,
        yearMax: 2022,
        mileageMax: 50000,
        status: "VERIFIED",
      }),
      true,
    );
    assert.equal(
      matchesListingFilters(baseRow, { status: "UNVERIFIED" }),
      false,
    );
  });

  it("filters by mileageMin", () => {
    assert.equal(matchesListingFilters(baseRow, { mileageMin: 40000 }), true);
    assert.equal(matchesListingFilters(baseRow, { mileageMin: 50000 }), false);
    assert.equal(matchesListingFilters(baseRow, { mileageMin: 0 }), true);
  });

  it("filters by condition, vehicleType, location, and colour", () => {
    const row = {
      ...baseRow,
      condition: "Good",
      vehicleType: "Car",
      locationLabel: "Berlin, Germany",
      colour: "Blue",
    };
    assert.equal(matchesListingFilters(row, { conditions: ["Good"] }), true);
    assert.equal(matchesListingFilters(row, { conditions: ["Excellent"] }), false);
    assert.equal(matchesListingFilters(row, { vehicleTypes: ["Car"] }), true);
    assert.equal(matchesListingFilters(row, { vehicleTypes: ["Truck"] }), false);
    assert.equal(matchesListingFilters(row, { location: "berlin" }), true);
    assert.equal(matchesListingFilters(row, { location: "Paris" }), false);
    assert.equal(matchesListingFilters(row, { colour: "blue" }), true);
    assert.equal(matchesListingFilters(row, { colour: "Red" }), false);
  });

  it("matches search against make, model, and VIN substrings", () => {
    assert.equal(matchesListingFilters(baseRow, { search: "honda" }), true);
    assert.equal(matchesListingFilters(baseRow, { search: "civic" }), true);
    assert.equal(matchesListingFilters(baseRow, { search: "1HGCM82633" }), true);
    assert.equal(matchesListingFilters(baseRow, { search: "toyota" }), false);
  });
});

describe("sortEnrichedListings", () => {
  it("sorts by price ascending after verified-first ordering", () => {
    const rows: EnrichedListingForFilter[] = [
      { ...baseRow, fiatPrice1e8: 20_000_000_000n, listedAt: 200n },
      { ...baseRow, passportStatus: "UNVERIFIED", fiatPrice1e8: 10_000_000_000n, listedAt: 300n },
    ];
    const sorted = sortEnrichedListings(rows, "price_asc", true);
    assert.equal(sorted[0]?.passportStatus, "VERIFIED");
    assert.equal(sorted[0]?.fiatPrice1e8, 20_000_000_000n);
    assert.equal(sorted[1]?.fiatPrice1e8, 10_000_000_000n);
  });

  it("sorts mixed USD and EUR listings by USD-equivalent price", () => {
    const rates = { ethUsd: ETH_USD, eurUsd: EUR_USD };
    const rows: EnrichedListingForFilter[] = [
      {
        ...baseRow,
        fiatPrice1e8: 20_000_000_000_000n,
        fiatCurrency: 1,
        listedAt: 200n,
      },
      {
        ...baseRow,
        fiatPrice1e8: 18_000_000_000_000n,
        fiatCurrency: 0,
        listedAt: 100n,
      },
    ];
    const sorted = sortEnrichedListings(rows, "price_asc", false, rates);
    assert.equal(sorted[0]?.fiatCurrency, 0);
    assert.equal(sorted[1]?.fiatCurrency, 1);
  });
});

describe("computeListingFacets", () => {
  it("returns fuel/body/transmission facets and per-currency price ranges", () => {
    const facets = computeListingFacets(
      [
        baseRow,
        {
          ...baseRow,
          fuelType: "Electric",
          bodyType: "SUV",
          transmission: "Automatic",
          fiatPrice1e8: 25_000_000_000n,
          fiatCurrency: 1,
        },
      ],
      2,
      [0, 1],
    );

    assert.deepEqual(facets.fuelTypes, ["Electric", "Petrol"]);
    assert.deepEqual(facets.bodyTypes, ["SUV", "Sedan"]);
    assert.deepEqual(facets.transmissions, ["Automatic", "Manual"]);
    assert.equal(facets.priceRanges.USD.min, 150);
    assert.equal(facets.priceRanges.USD.max, 150);
    assert.equal(facets.priceRanges.EUR.min, 250);
    assert.equal(facets.priceRanges.EUR.max, 250);
  });

  it("returns conditions, vehicleTypes, and years facets", () => {
    const facets = computeListingFacets(
      [
        {
          ...baseRow,
          year: 2021,
          condition: "Good",
          vehicleType: "Car",
        },
        {
          ...baseRow,
          year: 2019,
          condition: "Excellent",
          vehicleType: "Motorcycle",
        },
      ],
      2,
      [0],
    );

    assert.deepEqual(facets.conditions, ["Excellent", "Good"]);
    assert.deepEqual(facets.vehicleTypes, ["Car", "Motorcycle"]);
    assert.deepEqual(facets.years, [2019, 2021]);
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

describe("isDefaultListingsBrowse", () => {
  it("is true for unfiltered newest browse", () => {
    assert.equal(isDefaultListingsBrowse({ sort: "newest", status: "all" }), true);
  });

  it("is false when filters or seller are set", () => {
    assert.equal(isDefaultListingsBrowse({ sort: "newest", status: "all", make: "Honda" }), false);
    assert.equal(isDefaultListingsBrowse({ sort: "price_asc", status: "all" }), false);
    assert.equal(isDefaultListingsBrowse({ sort: "newest", status: "all" }, "0xabc"), false);
  });
});
