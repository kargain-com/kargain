import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPonderListingToRow } from "../lib/marketplace/map-ponder-listing.ts";

describe("mapPonderListingToRow chainId", () => {
  it("uses listing.chainId for hub and spoke (no DEFAULT stamp)", () => {
    const hub = mapPonderListingToRow({
      id: "1",
      tokenId: "1",
      chainId: 84532,
      seller: "0x1111111111111111111111111111111111111111",
      fiatPrice1e8: "100000000",
      active: true,
      listedAt: "1",
    });
    assert.equal(hub.chainId, 84532);

    const spoke = mapPonderListingToRow({
      id: "2",
      tokenId: "2",
      chainId: 11155111,
      seller: "0x1111111111111111111111111111111111111111",
      fiatPrice1e8: "200000000",
      active: true,
      listedAt: "2",
    });
    assert.equal(spoke.chainId, 11155111);
  });
});
