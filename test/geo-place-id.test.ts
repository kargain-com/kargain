import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPhotonOsmPlaceId,
  parsePhotonOsmPlaceId,
} from "../lib/geo/place-id.ts";

describe("buildPhotonOsmPlaceId", () => {
  it("builds N/W/R ids", () => {
    assert.equal(buildPhotonOsmPlaceId("N", 240109189), "photon:osm:N240109189");
    assert.equal(buildPhotonOsmPlaceId("W", 38862723), "photon:osm:W38862723");
    assert.equal(buildPhotonOsmPlaceId("R", 62428), "photon:osm:R62428");
  });

  it("accepts long-form OSM types and string ids", () => {
    assert.equal(buildPhotonOsmPlaceId("node", "1"), "photon:osm:N1");
    assert.equal(buildPhotonOsmPlaceId("way", 2), "photon:osm:W2");
    assert.equal(buildPhotonOsmPlaceId("relation", 3), "photon:osm:R3");
  });

  it("rejects invalid type or id", () => {
    assert.equal(buildPhotonOsmPlaceId("X", 1), null);
    assert.equal(buildPhotonOsmPlaceId("N", 0), null);
    assert.equal(buildPhotonOsmPlaceId("N", -1), null);
    assert.equal(buildPhotonOsmPlaceId("N", "abc"), null);
    assert.equal(buildPhotonOsmPlaceId("", 1), null);
  });
});

describe("parsePhotonOsmPlaceId", () => {
  it("round-trips built ids", () => {
    const id = buildPhotonOsmPlaceId("R", 62428);
    assert.ok(id);
    assert.deepEqual(parsePhotonOsmPlaceId(id), {
      osmType: "R",
      osmId: 62428,
    });
  });

  it("rejects garbage", () => {
    assert.equal(parsePhotonOsmPlaceId(""), null);
    assert.equal(parsePhotonOsmPlaceId("osm:R1"), null);
    assert.equal(parsePhotonOsmPlaceId("photon:osm:X1"), null);
    assert.equal(parsePhotonOsmPlaceId("photon:osm:R"), null);
    assert.equal(parsePhotonOsmPlaceId("photon:osm:R0"), null);
  });
});
