import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeListingFacets,
  matchesListingFilters,
  sortEnrichedListings,
  type EnrichedListingForFilter,
} from "../lib/marketplace/listing-query.ts";

const baseRow: EnrichedListingForFilter = {
  status: "VERIFIED",
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

  it("filters by currency and price bounds", () => {
    assert.equal(
      matchesListingFilters(baseRow, {
        currency: "USD",
        priceMin: "100",
        priceMax: "200",
      }),
      true,
    );
    assert.equal(
      matchesListingFilters(baseRow, {
        currency: "EUR",
      }),
      false,
    );
    assert.equal(
      matchesListingFilters(baseRow, {
        currency: "USD",
        priceMin: "200",
      }),
      false,
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
});

describe("sortEnrichedListings", () => {
  it("sorts by price ascending after verified-first ordering", () => {
    const rows: EnrichedListingForFilter[] = [
      { ...baseRow, fiatPrice1e8: 20_000_000_000n, listedAt: 200n },
      { ...baseRow, status: "UNVERIFIED", fiatPrice1e8: 10_000_000_000n, listedAt: 300n },
    ];
    const sorted = sortEnrichedListings(rows, "price_asc", true);
    assert.equal(sorted[0]?.status, "VERIFIED");
    assert.equal(sorted[0]?.fiatPrice1e8, 20_000_000_000n);
    assert.equal(sorted[1]?.fiatPrice1e8, 10_000_000_000n);
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
});
