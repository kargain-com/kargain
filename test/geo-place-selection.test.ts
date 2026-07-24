import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isCompletePlaceSelection,
  parsePlaceSelection,
  placeSelectionLabel,
  placeSelectionToWire,
  type PlaceSelection,
} from "../lib/geo/place-selection.ts";

const COMPLETE: PlaceSelection = {
  placeId: "osm:R123",
  countryCode: "de",
  label: "Berlin, Germany",
  city: "Berlin",
  region: "Berlin",
};

describe("isCompletePlaceSelection", () => {
  it("accepts trimmed complete selection", () => {
    assert.equal(isCompletePlaceSelection(COMPLETE), true);
  });

  it("rejects missing placeId, short country, or empty label", () => {
    assert.equal(isCompletePlaceSelection(null), false);
    assert.equal(
      isCompletePlaceSelection({ ...COMPLETE, placeId: "  " }),
      false,
    );
    assert.equal(
      isCompletePlaceSelection({ ...COMPLETE, countryCode: "D" }),
      false,
    );
    assert.equal(
      isCompletePlaceSelection({ ...COMPLETE, label: "" }),
      false,
    );
  });
});

describe("parsePlaceSelection", () => {
  it("parses complete object and uppercases country", () => {
    assert.deepEqual(parsePlaceSelection(COMPLETE), {
      placeId: "osm:R123",
      countryCode: "DE",
      label: "Berlin, Germany",
      city: "Berlin",
      region: "Berlin",
    });
  });

  it("uses label as city when city absent", () => {
    assert.deepEqual(
      parsePlaceSelection({
        placeId: "osm:R1",
        countryCode: "fr",
        label: "Paris, France",
      }),
      {
        placeId: "osm:R1",
        countryCode: "FR",
        label: "Paris, France",
        city: "Paris, France",
      },
    );
  });

  it("rejects free-text strings and incomplete objects", () => {
    assert.equal(parsePlaceSelection("Berlin"), null);
    assert.equal(parsePlaceSelection({ label: "Berlin" }), null);
    assert.equal(parsePlaceSelection({ lat: 1, lng: 2 }), null);
  });

  it("ignores lat/lng keys — identity is placeId only", () => {
    const parsed = parsePlaceSelection({
      ...COMPLETE,
      lat: 52.5,
      lng: 13.4,
    });
    assert.ok(parsed);
    assert.equal("lat" in parsed, false);
    assert.equal("lng" in parsed, false);
  });
});

describe("placeSelectionToWire", () => {
  it("emits placeId, countryCode, label, and optional city/region", () => {
    assert.deepEqual(placeSelectionToWire(COMPLETE), {
      placeId: "osm:R123",
      countryCode: "DE",
      label: "Berlin, Germany",
      city: "Berlin",
      region: "Berlin",
    });
  });

  it("omits empty region", () => {
    const wire = placeSelectionToWire({
      placeId: "osm:R1",
      countryCode: "FR",
      label: "Paris",
      city: "Paris",
    });
    assert.equal("region" in wire, false);
  });
});

describe("placeSelectionLabel", () => {
  it("prefers label", () => {
    assert.equal(placeSelectionLabel(COMPLETE), "Berlin, Germany");
  });

  it("returns null for absent selection", () => {
    assert.equal(placeSelectionLabel(null), null);
  });
});
