import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MARKET_FILTERS,
  clearFilterChip,
  filtersFromSearchParams,
  filtersToSearchParams,
  getFilterChips,
  marketFiltersToApiInput,
} from "../lib/marketplace/filter-params.ts";

describe("placeId market filter params", () => {
  it("round-trips placeId, placeLabel, and placeCountry in the URL", () => {
    const filters = {
      ...DEFAULT_MARKET_FILTERS,
      placeId: "photon:osm:N240109189",
      placeLabel: "Berlin, Germany",
      placeCountryCode: "DE",
    };
    const sp = filtersToSearchParams(filters);
    assert.equal(sp.get("placeId"), "photon:osm:N240109189");
    assert.equal(sp.get("placeLabel"), "Berlin, Germany");
    assert.equal(sp.get("placeCountry"), "DE");
    assert.equal(sp.get("location"), null);

    const parsed = filtersFromSearchParams(sp);
    assert.equal(parsed.placeId, "photon:osm:N240109189");
    assert.equal(parsed.placeLabel, "Berlin, Germany");
    assert.equal(parsed.placeCountryCode, "DE");
  });

  it("omits place companions when placeId is empty", () => {
    const sp = filtersToSearchParams({
      ...DEFAULT_MARKET_FILTERS,
      placeLabel: "orphan",
      placeCountryCode: "DE",
    });
    assert.equal(sp.get("placeId"), null);
    assert.equal(sp.get("placeLabel"), null);
    assert.equal(sp.get("placeCountry"), null);
  });

  it("sends only placeId to the API input", () => {
    const input = marketFiltersToApiInput({
      ...DEFAULT_MARKET_FILTERS,
      placeId: "photon:osm:N1",
      placeLabel: "Berlin, Germany",
      placeCountryCode: "DE",
    });
    assert.equal(input.placeId, "photon:osm:N1");
    assert.equal("location" in input, false);
    assert.equal("placeLabel" in input, false);
  });

  it("chip uses placeLabel and clear resets all place fields", () => {
    const filters = {
      ...DEFAULT_MARKET_FILTERS,
      placeId: "photon:osm:N1",
      placeLabel: "Berlin, Germany",
      placeCountryCode: "DE",
    };
    const chips = getFilterChips(filters);
    assert.ok(chips.some((c) => c.key === "placeId" && c.label === "Berlin, Germany"));

    const cleared = clearFilterChip(filters, "placeId");
    assert.equal(cleared.placeId, "");
    assert.equal(cleared.placeLabel, "");
    assert.equal(cleared.placeCountryCode, "");
  });
});
