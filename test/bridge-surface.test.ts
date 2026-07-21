import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bridgeBlockReasonCopy,
  deriveBridgeSurface,
  type BridgeSurfaceInput,
  type BridgeSurfaceResult,
} from "../lib/passport/bridge-surface.ts";

const HIDDEN: BridgeSurfaceResult = {
  visible: false,
  mode: "hidden",
  canBridge: false,
  blockReason: null,
};

function input(overrides: Partial<BridgeSurfaceInput> = {}): BridgeSurfaceInput {
  return {
    isOwner: true,
    chainId: 84532,
    listingState: "inactive",
    auctionBlocks: false,
    passportStatus: "VERIFIED",
    ...overrides,
  };
}

describe("deriveBridgeSurface", () => {
  it("allows bridge for owner on hub custody with inactive listing and no auction", () => {
    assert.deepEqual(deriveBridgeSurface(input()), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
    });
  });

  it("allows bridge for owner on spoke custody (return to hub)", () => {
    assert.deepEqual(deriveBridgeSurface(input({ chainId: 11155111 })), {
      visible: true,
      mode: "action",
      canBridge: true,
      blockReason: null,
    });
  });

  it("allows UNVERIFIED when other gates pass", () => {
    assert.equal(
      deriveBridgeSurface(input({ passportStatus: "UNVERIFIED" })).canBridge,
      true,
    );
  });

  it("hides for non-owner", () => {
    assert.deepEqual(deriveBridgeSurface(input({ isOwner: false })), HIDDEN);
  });

  it("hides on non-star chain", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ chainId: 31337 })),
      HIDDEN,
    );
  });

  it("fail-closes unresolved listing pending", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ listingState: "pending" })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "unresolved",
      },
    );
  });

  it("fail-closes unresolved listing failure", () => {
    assert.equal(
      deriveBridgeSurface(input({ listingState: "failure" })).blockReason,
      "unresolved",
    );
  });

  it("fail-closes unresolved auctionBlocks", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ auctionBlocks: undefined })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "unresolved",
      },
    );
  });

  it("disables when listed", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ listingState: "active" })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "listed",
      },
    );
  });

  it("disables when auction blocks", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ auctionBlocks: true })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "auction",
      },
    );
  });

  it("disables when DISPUTED", () => {
    assert.deepEqual(
      deriveBridgeSurface(input({ passportStatus: "DISPUTED" })),
      {
        visible: true,
        mode: "action",
        canBridge: false,
        blockReason: "disputed",
      },
    );
  });

  it("DISPUTED wins over listed", () => {
    assert.equal(
      deriveBridgeSurface(
        input({ listingState: "active", passportStatus: "DISPUTED" }),
      ).blockReason,
      "disputed",
    );
  });

  it("DISPUTED wins over auction", () => {
    assert.equal(
      deriveBridgeSurface(
        input({ auctionBlocks: true, passportStatus: "DISPUTED" }),
      ).blockReason,
      "disputed",
    );
  });

  it("spoke custody still fail-closes listed", () => {
    assert.equal(
      deriveBridgeSurface(
        input({ chainId: 11155111, listingState: "active" }),
      ).blockReason,
      "listed",
    );
  });
});

describe("bridgeBlockReasonCopy", () => {
  it("returns sentence-case reasons", () => {
    assert.equal(
      bridgeBlockReasonCopy("listed"),
      "Delist this vehicle before bridging.",
    );
    assert.equal(
      bridgeBlockReasonCopy("auction"),
      "Finish or cancel the auction before bridging.",
    );
    assert.equal(
      bridgeBlockReasonCopy("disputed"),
      "Resolve the dispute before bridging.",
    );
    assert.equal(
      bridgeBlockReasonCopy("unresolved"),
      "Waiting for listing and auction status…",
    );
  });
});
