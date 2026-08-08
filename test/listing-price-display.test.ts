import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import {
  askingPriceInputUnit,
  deriveListingAskingPrice,
  formatListingAssetAsking,
} from "../lib/commerce/listing-price-display.ts";

const BASE = 84532;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ZERO = "0x0000000000000000000000000000000000000000";

describe("deriveListingAskingPrice", () => {
  it("formats fiat 1e8 asking", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Fiat,
      price: 35_000_000_000_000n, // $350000 at 1e8
      currencyCode: "USD",
      asset: ZERO,
      chainId: BASE,
    });
    assert.equal(asking.status, "fiat");
    if (asking.status === "fiat") {
      assert.equal(asking.amount1e8, 35_000_000_000_000n);
      assert.equal(asking.currencyCode, "USD");
    }
  });

  it("formats asset USDC asking matching wallet settlement units", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: "350000000000", // 350000 * 1e6
      asset: USDC,
      chainId: BASE,
    });
    assert.equal(asking.status, "asset");
    if (asking.status === "asset") {
      assert.equal(asking.decimals, 6);
      assert.equal(asking.unitLabel, "USDC");
      assert.equal(
        formatListingAssetAsking(asking.amount, asking.decimals, asking.unitLabel),
        "350000 USDC",
      );
    }
  });

  it("does not treat asset raw as fiat (regression $3500 lie)", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 350000000000n,
      asset: USDC,
      chainId: BASE,
    });
    assert.notEqual(asking.status, "fiat");
    assert.equal(asking.status, "asset");
  });

  it("returns unresolved when denomination missing", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: undefined,
      price: 1n,
      chainId: BASE,
    });
    assert.equal(asking.status, "unresolved");
  });

  it("returns unresolved for unknown ERC-20 without decimals", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 1000n,
      asset: "0x2222222222222222222222222222222222222222",
      chainId: BASE,
    });
    assert.equal(asking.status, "unresolved");
  });
});

describe("askingPriceInputUnit", () => {
  it("returns USDC for asset denomination on registered token", () => {
    assert.equal(
      askingPriceInputUnit({
        denominationKind: DENOMINATION_KIND.Asset,
        settlementAsset: USDC,
        chainId: BASE,
      }),
      "USDC",
    );
  });

  it("returns fiat code for fiat denomination", () => {
    assert.equal(
      askingPriceInputUnit({
        denominationKind: DENOMINATION_KIND.Fiat,
        fiatCurrencyCode: "EUR",
        settlementAsset: ZERO,
        chainId: BASE,
      }),
      "EUR",
    );
  });
});
