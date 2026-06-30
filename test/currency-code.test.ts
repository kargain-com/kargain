import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyCodeBytes32 } from "../scripts/lib/chainlink-feeds.ts";
import {
  decodeCurrencyCode,
  encodeCurrencyCode,
  isDisplayCurrency,
  legacyFiatFromCurrencyCode,
  legacyFiatToCode,
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
  it("maps all display fiat codes to enum indices", () => {
    assert.equal(legacyFiatFromCurrencyCode("USD"), 0);
    assert.equal(legacyFiatFromCurrencyCode("EUR"), 1);
    assert.equal(legacyFiatFromCurrencyCode("CNY"), 2);
    assert.equal(legacyFiatFromCurrencyCode("INR"), 3);
    assert.equal(legacyFiatFromCurrencyCode("BRL"), 4);
    assert.equal(legacyFiatFromCurrencyCode("IDR"), 5);
    assert.equal(legacyFiatFromCurrencyCode("AUD"), 6);
    assert.equal(legacyFiatFromCurrencyCode("AED"), 7);
    assert.equal(legacyFiatFromCurrencyCode("KRW"), 8);
    assert.equal(legacyFiatFromCurrencyCode("RUB"), 9);
    assert.equal(legacyFiatFromCurrencyCode("JPY"), 10);
  });

  it("falls back unknown listing codes to USD", () => {
    assert.equal(legacyFiatFromCurrencyCode("GBP"), 0);
    assert.equal(legacyFiatFromCurrencyCode("NATIVE"), 0);
  });

  it("roundtrips via legacyFiatToCode", () => {
    for (let i = 0; i <= 10; i++) {
      assert.equal(legacyFiatFromCurrencyCode(legacyFiatToCode(i as 0)), i);
    }
  });
});

describe("isDisplayCurrency", () => {
  it("accepts all display currencies including crypto", () => {
    assert.equal(isDisplayCurrency("USD"), true);
    assert.equal(isDisplayCurrency("CNY"), true);
    assert.equal(isDisplayCurrency("AED"), true);
    assert.equal(isDisplayCurrency("KRW"), true);
    assert.equal(isDisplayCurrency("JPY"), true);
    assert.equal(isDisplayCurrency("ETH"), true);
    assert.equal(isDisplayCurrency("BTC"), true);
    assert.equal(isDisplayCurrency("GBP"), false);
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
