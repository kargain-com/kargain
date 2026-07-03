import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldEnableListingChainStatusConfirm } from "../lib/marketplace/listing-chain-status-confirm-fetch.ts";

describe("listing-chain-status-confirm-fetch", () => {
  it("does not confirm before defer gate or without rows", () => {
    assert.equal(
      shouldEnableListingChainStatusConfirm({ deferReady: false, hasRows: true }),
      false,
    );
    assert.equal(
      shouldEnableListingChainStatusConfirm({ deferReady: true, hasRows: false }),
      false,
    );
  });

  it("confirms when defer gate fired and rows exist", () => {
    assert.equal(
      shouldEnableListingChainStatusConfirm({ deferReady: true, hasRows: true }),
      true,
    );
  });
});
