import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_INDEXED_KAR_PRO_METADATA,
  indexKarProMetadataFromUri,
} from "../src/lib/ponder-kar-pro-metadata.ts";

describe("indexKarProMetadataFromUri place denorm", () => {
  it("returns empty place fields for non-arweave URI", async () => {
    const indexed = await indexKarProMetadataFromUri("ipfs://not-supported");
    assert.deepEqual(indexed, EMPTY_INDEXED_KAR_PRO_METADATA);
  });

  it("extracts slug and place from KarPro JSON", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "1.0",
          name: "Berlin Broker",
          slug: "berlin-broker",
          category: "BROKER",
          location: {
            placeId: "osm:R123",
            countryCode: "de",
            label: "Berlin, Germany",
            city: "Berlin",
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const indexed = await indexKarProMetadataFromUri("https://example.com/meta.json");
      assert.deepEqual(indexed, {
        slug: "berlin-broker",
        locationLabel: "Berlin, Germany",
        locationPlaceId: "osm:R123",
        locationCountryCode: "DE",
      });
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("clears place when metadata has no location", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "1.0",
          name: "Ada",
          slug: "ada-mechanic",
          category: "MECHANIC",
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const indexed = await indexKarProMetadataFromUri("https://example.com/meta.json");
      assert.equal(indexed.slug, "ada-mechanic");
      assert.equal(indexed.locationPlaceId, "");
      assert.equal(indexed.locationCountryCode, "");
      assert.equal(indexed.locationLabel, "");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("rejects free-text location string", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          version: "1.0",
          name: "Ada",
          slug: "ada-mechanic",
          category: "MECHANIC",
          location: "Berlin",
        }),
        { status: 200 },
      )) as typeof fetch;

    try {
      const indexed = await indexKarProMetadataFromUri("https://example.com/meta.json");
      assert.equal(indexed.slug, "ada-mechanic");
      assert.equal(indexed.locationPlaceId, "");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
