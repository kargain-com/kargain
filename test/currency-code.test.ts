import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyCodeBytes32 } from "../scripts/lib/chainlink-feeds.ts";
import {
  decodeCurrencyCode,
  legacyFiatFromCurrencyCode,
  payTokenToLegacyPayAsset,
} from "../lib/marketplace/currency-code.ts";

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
