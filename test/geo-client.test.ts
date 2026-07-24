import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGeoReversePath,
  buildGeoSuggestPath,
  reversePlace,
  suggestPlaces,
} from "../lib/geo/client.ts";
import { GeoError } from "../lib/geo/types.ts";

const samplePlace = {
  placeId: "photon:osm:N123",
  countryCode: "DE",
  label: "Berlin, Germany",
  city: "Berlin",
  region: "Berlin",
  lat: 52.52,
  lng: 13.405,
  source: "photon" as const,
  layer: "city",
};

describe("buildGeoSuggestPath / buildGeoReversePath", () => {
  it("encodes suggest query and optional lang", () => {
    assert.equal(
      buildGeoSuggestPath({ q: "Berlin" }),
      "/api/geo/suggest?q=Berlin",
    );
    assert.equal(
      buildGeoSuggestPath({ q: "  Paris  ", lang: "fr" }),
      "/api/geo/suggest?q=Paris&lang=fr",
    );
  });

  it("encodes reverse lat/lng and optional lang", () => {
    assert.equal(
      buildGeoReversePath({ lat: 52.52, lng: 13.405 }),
      "/api/geo/reverse?lat=52.52&lng=13.405",
    );
    assert.equal(
      buildGeoReversePath({ lat: 48.8, lng: 2.3, lang: "en" }),
      "/api/geo/reverse?lat=48.8&lng=2.3&lang=en",
    );
  });
});

describe("suggestPlaces", () => {
  it("returns empty array without calling fetch when q is blank", async () => {
    let called = 0;
    const places = await suggestPlaces({ q: "  " }, async () => {
      called += 1;
      throw new Error("should not fetch");
    });
    assert.deepEqual(places, []);
    assert.equal(called, 0);
  });

  it("maps places from JSON body", async () => {
    const places = await suggestPlaces({ q: "Berlin", lang: "en" }, async (input) => {
      assert.equal(String(input), "/api/geo/suggest?q=Berlin&lang=en");
      return new Response(JSON.stringify({ places: [samplePlace] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    assert.deepEqual(places, [samplePlace]);
  });

  it("returns [] when places missing", async () => {
    const places = await suggestPlaces({ q: "X" }, async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    assert.deepEqual(places, []);
  });

  it("throws GeoError invalid_query on HTTP 400", async () => {
    await assert.rejects(
      () =>
        suggestPlaces({ q: "x" }, async () => new Response("bad", { status: 400 })),
      (err: unknown) => err instanceof GeoError && err.code === "invalid_query",
    );
  });

  it("throws GeoError upstream on HTTP 502", async () => {
    await assert.rejects(
      () =>
        suggestPlaces({ q: "x" }, async () => new Response("up", { status: 502 })),
      (err: unknown) => err instanceof GeoError && err.code === "upstream",
    );
  });
});

describe("reversePlace", () => {
  it("returns place from JSON body", async () => {
    const place = await reversePlace(
      { lat: 52.52, lng: 13.405, lang: "de" },
      async (input) => {
        assert.equal(
          String(input),
          "/api/geo/reverse?lat=52.52&lng=13.405&lang=de",
        );
        return new Response(JSON.stringify({ place: samplePlace }), {
          status: 200,
        });
      },
    );
    assert.deepEqual(place, samplePlace);
  });

  it("returns null when place is null", async () => {
    const place = await reversePlace({ lat: 0, lng: 0 }, async () =>
      new Response(JSON.stringify({ place: null }), { status: 200 }),
    );
    assert.equal(place, null);
  });
});
