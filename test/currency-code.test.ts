import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyCodeBytes32 } from "../scripts/lib/chainlink-feeds.ts";
import {
  decodeCurrencyCode,
  encodeCurrencyCode,
  legacyFiatFromCurrencyCode,
  listingCurrencyCodesForChain,
  payTokenToLegacyPayAsset,
} from "../lib/marketplace/currency-code.ts";

describe("encodeCurrencyCode", () => {
  it("roundtrips with decodeCurrencyCode", () => {
    for (const iso of ["USD", "EUR", "GBP"] as const) {
      const encoded = encodeCurrencyCode(iso);
      assert.equal(decodeCurrencyCode(encoded), iso);
      assert.equal(encoded, currencyCodeBytes32(iso));
    }
  });
});

describe("listingCurrencyCodesForChain", () => {
  it("returns USD only on Base Sepolia", () => {
    assert.deepEqual(listingCurrencyCodesForChain(84532), ["USD"]);
  });

  it("returns multi-currency on Ethereum Sepolia", () => {
    assert.deepEqual(listingCurrencyCodesForChain(11155111), ["USD", "EUR", "GBP", "JPY"]);
  });

  it("falls back to USD for unknown chains", () => {
    assert.deepEqual(listingCurrencyCodesForChain(999), ["USD"]);
  });
});

describe("decodeCurrencyCode", () => {
  it("decodes USD and EUR", () => {
    assert.equal(decodeCurrencyCode(currencyCodeBytes32("USD")), "USD");
    assert.equal(decodeCurrencyCode(currencyCodeBytes32("EUR")), "EUR");
  });

  it("decodes NATIVE", () => {
    assert.equal(decodeCurrencyCode(currencyCodeBytes32("NATIVE")), "NATIVE");
  });
});

describe("legacyFiatFromCurrencyCode", () => {
  it("maps EUR to 1 and others to 0", () => {
    assert.equal(legacyFiatFromCurrencyCode("USD"), 0);
    assert.equal(legacyFiatFromCurrencyCode("EUR"), 1);
    assert.equal(legacyFiatFromCurrencyCode("NATIVE"), 0);
  });
});

describe("payTokenToLegacyPayAsset", () => {
  const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  it("maps zero address to native", () => {
    assert.equal(
      payTokenToLegacyPayAsset("0x0000000000000000000000000000000000000000", usdc),
      0,
    );
    assert.equal(payTokenToLegacyPayAsset("", usdc), 0);
  });

  it("maps USDC to 1", () => {
    assert.equal(payTokenToLegacyPayAsset(usdc, usdc), 1);
  });
});
