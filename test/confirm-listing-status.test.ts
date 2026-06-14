import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareListingStatus,
  listingStatusKey,
  pickListingsForChainConfirm,
} from "../lib/passport/confirm-listing-status.ts";
import { passportStatusFromChainIndex } from "../lib/passport/passport-status-chain.ts";

describe("passportStatusFromChainIndex", () => {
  it("maps on-chain enum indices", () => {
    assert.equal(passportStatusFromChainIndex(0), "UNVERIFIED");
    assert.equal(passportStatusFromChainIndex(1), "VERIFIED");
    assert.equal(passportStatusFromChainIndex(2), "DISPUTED");
    assert.equal(passportStatusFromChainIndex(9), null);
  });
});

describe("compareListingStatus", () => {
  it("returns drift when ponder and chain differ", () => {
    assert.deepEqual(compareListingStatus("VERIFIED", "DISPUTED"), {
      ponderStatus: "VERIFIED",
      chainStatus: "DISPUTED",
    });
  });

  it("returns null when statuses match", () => {
    assert.equal(compareListingStatus("UNVERIFIED", "UNVERIFIED"), null);
  });

  it("returns null when chain status is unknown", () => {
    assert.equal(compareListingStatus("VERIFIED", null), null);
  });
});

describe("pickListingsForChainConfirm", () => {
  it("caps batch size for RPC reads", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      chainId: 84532,
      tokenId: String(i),
    }));
    assert.equal(pickListingsForChainConfirm(rows).length, 12);
    assert.equal(pickListingsForChainConfirm(rows, 5).length, 5);
  });
});

describe("listingStatusKey", () => {
  it("builds stable map keys", () => {
    assert.equal(listingStatusKey(84532, "7"), "84532:7");
  });
});
