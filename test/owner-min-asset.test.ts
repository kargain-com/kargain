import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEther, parseUnits } from "viem";

import {
  auctionAssetLabelFromAddress,
  formatOwnerMinAsset,
  isValidOwnerMinAsset,
  parseOwnerMinAsset,
} from "../lib/auction/owner-min-asset.ts";

describe("parseOwnerMinAsset", () => {
  it("parses ETH to wei", () => {
    assert.equal(parseOwnerMinAsset("1.5", "ETH"), parseEther("1.5"));
  });

  it("parses USDC to 6 decimals", () => {
    assert.equal(parseOwnerMinAsset("100.50", "USDC"), parseUnits("100.50", 6));
  });

  it("returns null for empty or invalid", () => {
    assert.equal(parseOwnerMinAsset("", "ETH"), null);
    assert.equal(parseOwnerMinAsset("  ", "USDC"), null);
    assert.equal(parseOwnerMinAsset("abc", "ETH"), null);
  });
});

describe("formatOwnerMinAsset", () => {
  it("formats ETH without suffix", () => {
    assert.equal(formatOwnerMinAsset(parseEther("1.5"), "ETH"), "1.5");
  });

  it("formats USDC without suffix", () => {
    assert.equal(formatOwnerMinAsset(parseUnits("100.5", 6), "USDC"), "100.5");
  });
});

describe("isValidOwnerMinAsset", () => {
  it("requires positive amount", () => {
    assert.equal(isValidOwnerMinAsset("0", "ETH"), false);
    assert.equal(isValidOwnerMinAsset("0.01", "ETH"), true);
    assert.equal(isValidOwnerMinAsset("1", "USDC"), true);
    assert.equal(isValidOwnerMinAsset("", "USDC"), false);
  });
});

describe("auctionAssetLabelFromAddress", () => {
  it("maps zero address to ETH", () => {
    assert.equal(
      auctionAssetLabelFromAddress(
        "0x0000000000000000000000000000000000000000",
      ),
      "ETH",
    );
    assert.equal(auctionAssetLabelFromAddress(null), "ETH");
  });

  it("maps non-zero to USDC", () => {
    assert.equal(
      auctionAssetLabelFromAddress(
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      ),
      "USDC",
    );
  });
});
