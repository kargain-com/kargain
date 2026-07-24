import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildKarProMetadataJson,
  parseKarProMetadataJson,
} from "../lib/kar-pro/kar-pro-metadata.ts";
import type { PlaceSelection } from "../lib/geo/place-selection.ts";

const PLACE: PlaceSelection = {
  placeId: "osm:R123",
  countryCode: "DE",
  label: "Berlin, Germany",
  city: "Berlin",
  region: "Berlin",
};

describe("kar-pro metadata location", () => {
  it("round-trips complete location", () => {
    const json = buildKarProMetadataJson({
      categoryIndex: 3,
      name: "Berlin Broker",
      slug: "berlin-broker",
      location: PLACE,
    });
    const parsed = parseKarProMetadataJson(json);
    assert.ok(parsed);
    assert.deepEqual(parsed.location, {
      placeId: "osm:R123",
      countryCode: "DE",
      label: "Berlin, Germany",
      city: "Berlin",
      region: "Berlin",
    });
  });

  it("omits location when absent or incomplete", () => {
    const without = parseKarProMetadataJson(
      buildKarProMetadataJson({
        categoryIndex: 0,
        name: "Ada",
        slug: "ada-mechanic",
      }),
    );
    assert.equal(without?.location, undefined);

    const cleared = parseKarProMetadataJson(
      buildKarProMetadataJson({
        categoryIndex: 0,
        name: "Ada",
        slug: "ada-mechanic",
        location: null,
      }),
    );
    assert.equal(cleared?.location, undefined);
  });

  it("rejects free-text location on parse", () => {
    const parsed = parseKarProMetadataJson(
      JSON.stringify({
        version: "1.0",
        name: "Ada",
        slug: "ada",
        category: "MECHANIC",
        location: "Berlin",
      }),
    );
    assert.ok(parsed);
    assert.equal(parsed.location, undefined);
  });

  it("does not emit lat/lng keys", () => {
    const json = buildKarProMetadataJson({
      categoryIndex: 0,
      name: "Ada",
      slug: "ada-mechanic",
      location: PLACE,
    });
    const raw = JSON.parse(json) as Record<string, unknown>;
    const loc = raw.location as Record<string, unknown>;
    assert.equal("lat" in loc, false);
    assert.equal("lng" in loc, false);
  });
});
