import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldFetchListingFacets } from "../lib/marketplace/listing-facets-fetch.ts";

const closed = {
  priceOpen: false,
  makeOpen: false,
  fuelOpen: false,
  drawerOpen: false,
} as const;

describe("listing-facets-fetch", () => {
  it("does not fetch when all filter UI is closed", () => {
    assert.equal(shouldFetchListingFacets(closed), false);
  });

  it("fetches when any filter control is open", () => {
    assert.equal(shouldFetchListingFacets({ ...closed, priceOpen: true }), true);
    assert.equal(shouldFetchListingFacets({ ...closed, makeOpen: true }), true);
    assert.equal(shouldFetchListingFacets({ ...closed, fuelOpen: true }), true);
    assert.equal(shouldFetchListingFacets({ ...closed, drawerOpen: true }), true);
  });
});
