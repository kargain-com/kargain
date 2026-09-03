import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnits } from "viem";

import {
  auctionAssetLabelFromAddress,
  formatOwnerMinAsset,
  isValidOwnerMinAsset,
  parseOwnerMinAsset,
} from "../lib/auction/owner-min-asset.ts";
import {
  COMMERCIAL_ACTIVE,
  nativeUnitOf,
} from "../lib/web3/commercial-active.ts";
import { parseNativeAmount } from "../lib/web3/native-amount.ts";

const ethUnit = nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);

describe("parseOwnerMinAsset", () => {
  it("parses ETH to wei", () => {
    assert.equal(
      parseOwnerMinAsset("1.5", "ETH", ethUnit),
      parseNativeAmount("1.5", ethUnit),
    );
  });

  it("parses USDC to 6 decimals", () => {
    assert.equal(
      parseOwnerMinAsset("100.50", "USDC", ethUnit),
      parseUnits("100.50", 6),
    );
  });

  it("returns null for empty or invalid", () => {
    assert.equal(parseOwnerMinAsset("", "ETH", ethUnit), null);
    assert.equal(parseOwnerMinAsset("  ", "USDC", ethUnit), null);
    assert.equal(parseOwnerMinAsset("abc", "ETH", ethUnit), null);
  });
});

describe("formatOwnerMinAsset", () => {
  it("formats ETH without suffix", () => {
    const amount = parseNativeAmount("1.5", ethUnit)!;
    assert.equal(formatOwnerMinAsset(amount, "ETH", ethUnit), "1.5");
  });

  it("formats USDC without suffix", () => {
    assert.equal(
      formatOwnerMinAsset(parseUnits("100.5", 6), "USDC", ethUnit),
      "100.5",
    );
  });
});

describe("isValidOwnerMinAsset", () => {
  it("requires positive amount", () => {
    assert.equal(isValidOwnerMinAsset("0", "ETH", ethUnit), false);
    assert.equal(isValidOwnerMinAsset("0.01", "ETH", ethUnit), true);
    assert.equal(isValidOwnerMinAsset("1", "USDC", ethUnit), true);
    assert.equal(isValidOwnerMinAsset("", "USDC", ethUnit), false);
  });
});

describe("auctionAssetLabelFromAddress", () => {
  it("maps zero address to ETH", () => {
    assert.equal(
      auctionAssetLabelFromAddress(
        "0x0000000000000000000000000000000000000000",
        84532,
      ),
      "ETH",
    );
    assert.equal(auctionAssetLabelFromAddress(null, 84532), "ETH");
  });

  it("maps registered USDC to USDC", () => {
    assert.equal(
      auctionAssetLabelFromAddress(
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        84532,
      ),
      "USDC",
    );
  });
});
