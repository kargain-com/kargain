import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareListingStatus } from "../lib/passport/confirm-listing-status.ts";
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
