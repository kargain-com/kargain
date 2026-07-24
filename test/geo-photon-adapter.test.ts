import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPhotonPlaceDirectory } from "../lib/geo/adapters/photon.ts";
import {
  DEFAULT_PHOTON_BASE_URL,
  resolvePhotonBaseUrl,
} from "../lib/geo/photon-config.ts";
import { GeoError } from "../lib/geo/types.ts";

describe("resolvePhotonBaseUrl", () => {
  it("defaults and trims trailing slashes", () => {
    assert.equal(resolvePhotonBaseUrl(undefined), DEFAULT_PHOTON_BASE_URL);
    assert.equal(resolvePhotonBaseUrl(""), DEFAULT_PHOTON_BASE_URL);
    assert.equal(resolvePhotonBaseUrl("   "), DEFAULT_PHOTON_BASE_URL);
    assert.equal(
      resolvePhotonBaseUrl(" https://photon.example/ "),
      "https://photon.example",
    );
    assert.equal(
      resolvePhotonBaseUrl("https://photon.example///"),
      "https://photon.example",
    );
  });
});

describe("createPhotonPlaceDirectory", () => {
  it("suggests places from a GeoJSON body", async () => {
    const calls: string[] = [];
    const directory = createPhotonPlaceDirectory({
      baseUrl: "https://photon.test",
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [13.3888599, 52.5170365],
                },
                properties: {
                  name: "Berlin",
                  country: "Germany",
                  countrycode: "DE",
                  osm_type: "N",
                  osm_id: 240109189,
                  type: "city",
                },
              },
              {
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [13.39, 52.52],
                },
                properties: {
                  name: "Somewhere St",
                  countrycode: "DE",
                  osm_type: "W",
                  osm_id: 1,
                  type: "street",
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    });

    const places = await directory.suggest({ q: "Berlin", lang: "en" });
    assert.equal(places.length, 1);
    assert.equal(places[0]!.placeId, "photon:osm:N240109189");
    assert.ok(calls[0]?.includes("https://photon.test/api?"));
    assert.ok(calls[0]?.includes("q=Berlin"));
    const url = new URL(calls[0]!);
    assert.deepEqual(url.searchParams.getAll("layer"), ["city", "locality"]);
  });

  it("maps Photon HTTP 400 (invalid layer) to GeoError upstream", async () => {
    const directory = createPhotonPlaceDirectory({
      baseUrl: "https://photon.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            layer: [{ message: "Unknown layer type." }],
          }),
          { status: 400 },
        ),
    });
    await assert.rejects(
      () => directory.suggest({ q: "Rome" }),
      (err: unknown) =>
        err instanceof GeoError && err.code === "upstream",
    );
  });

  it("returns empty array for blank query without fetching", async () => {
    let fetched = false;
    const directory = createPhotonPlaceDirectory({
      fetch: async () => {
        fetched = true;
        return new Response("{}", { status: 200 });
      },
    });
    assert.deepEqual(await directory.suggest({ q: "   " }), []);
    assert.equal(fetched, false);
  });

  it("reverse returns null when no city-level feature", async () => {
    const directory = createPhotonPlaceDirectory({
      baseUrl: "https://photon.test",
      fetch: async () =>
        new Response(
          JSON.stringify({
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [13.4, 52.5] },
                properties: {
                  name: "Road",
                  countrycode: "DE",
                  osm_type: "W",
                  osm_id: 9,
                  type: "street",
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    assert.equal(await directory.reverse({ lat: 52.5, lng: 13.4 }), null);
  });

  it("maps HTTP 5xx to GeoError upstream", async () => {
    const directory = createPhotonPlaceDirectory({
      baseUrl: "https://photon.test",
      fetch: async () => new Response("nope", { status: 503 }),
    });
    await assert.rejects(
      () => directory.suggest({ q: "Berlin" }),
      (err: unknown) =>
        err instanceof GeoError && err.code === "upstream",
    );
  });

  it("maps abort to GeoError timeout", async () => {
    const directory = createPhotonPlaceDirectory({
      baseUrl: "https://photon.test",
      timeoutMs: 5,
      fetch: async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    await assert.rejects(
      () => directory.suggest({ q: "Berlin" }),
      (err: unknown) =>
        err instanceof GeoError && err.code === "timeout",
    );
  });

  it("rejects reverse with out-of-range coordinates", async () => {
    const directory = createPhotonPlaceDirectory({
      fetch: async () => new Response("{}", { status: 200 }),
    });
    await assert.rejects(
      () => directory.reverse({ lat: 99, lng: 0 }),
      (err: unknown) =>
        err instanceof GeoError && err.code === "invalid_query",
    );
  });
});
