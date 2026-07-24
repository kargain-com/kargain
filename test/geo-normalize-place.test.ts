import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePhotonFeature } from "../lib/geo/normalize-place.ts";

const BERLIN_OSM = { osm_type: "N", osm_id: 240109189 };

function feature(
  properties: Record<string, unknown>,
  coordinates: [number, number] = [13.3888599, 52.5170365],
) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
  };
}

describe("normalizePhotonFeature", () => {
  it("normalizes a city feature", () => {
    const place = normalizePhotonFeature(
      feature({
        ...BERLIN_OSM,
        name: "Berlin",
        state: "Berlin",
        country: "Germany",
        countrycode: "DE",
        type: "city",
        osm_key: "place",
        osm_value: "city",
      }),
    );
    assert.ok(place);
    assert.equal(place.placeId, "photon:osm:N240109189");
    assert.equal(place.countryCode, "DE");
    assert.equal(place.city, "Berlin");
    assert.equal(place.layer, "city");
    assert.equal(place.source, "photon");
    assert.match(place.label, /Berlin/);
    assert.equal(place.lat, 52.5170365);
    assert.equal(place.lng, 13.3888599);
  });

  it("maps EN/DE/RU display names to the same placeId", () => {
    const ids = ["Berlin", "Berlin", "Берлин"].map((name) => {
      const place = normalizePhotonFeature(
        feature({
          ...BERLIN_OSM,
          name,
          country: "Germany",
          countrycode: "de",
          type: "city",
        }),
      );
      assert.ok(place);
      return place.placeId;
    });
    assert.equal(ids[0], ids[1]);
    assert.equal(ids[1], ids[2]);
  });

  it("rejects street and house layers", () => {
    assert.equal(
      normalizePhotonFeature(
        feature({
          ...BERLIN_OSM,
          name: "Unter den Linden",
          countrycode: "DE",
          type: "street",
        }),
      ),
      null,
    );
    assert.equal(
      normalizePhotonFeature(
        feature({
          ...BERLIN_OSM,
          name: "1",
          countrycode: "DE",
          type: "house",
        }),
      ),
      null,
    );
  });

  it("promotes suburb/district to city when properties.city is set", () => {
    const place = normalizePhotonFeature(
      feature({
        osm_type: "N",
        osm_id: 123,
        name: "Mitte",
        city: "Berlin",
        country: "Germany",
        countrycode: "DE",
        type: "district",
      }),
    );
    assert.ok(place);
    assert.equal(place.city, "Berlin");
    assert.equal(place.layer, "city");
    assert.equal(place.placeId, "photon:osm:N123");
  });

  it("returns null when suburb has no city to promote", () => {
    assert.equal(
      normalizePhotonFeature(
        feature({
          osm_type: "N",
          osm_id: 123,
          name: "Mitte",
          countrycode: "DE",
          type: "suburb",
        }),
      ),
      null,
    );
  });

  it("returns null when countrycode is missing", () => {
    assert.equal(
      normalizePhotonFeature(
        feature({
          ...BERLIN_OSM,
          name: "Berlin",
          type: "city",
        }),
      ),
      null,
    );
  });

  it("returns null for invalid coordinates", () => {
    assert.equal(
      normalizePhotonFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [999, 52] },
        properties: {
          ...BERLIN_OSM,
          name: "Berlin",
          countrycode: "DE",
          type: "city",
        },
      }),
      null,
    );
  });

  it("accepts town/village/municipality layers", () => {
    for (const layer of ["town", "village", "municipality"] as const) {
      const place = normalizePhotonFeature(
        feature({
          osm_type: "R",
          osm_id: 1,
          name: "Sample",
          countrycode: "FR",
          type: layer,
        }),
      );
      assert.ok(place, layer);
      assert.equal(place.layer, layer);
      assert.equal(place.city, "Sample");
    }
  });
});
