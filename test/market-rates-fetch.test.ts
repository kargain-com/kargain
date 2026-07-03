import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayCurrencyNeedsRates,
  shouldEnableMarketRates,
} from "../lib/marketplace/market-rates-fetch.ts";

describe("market-rates-fetch", () => {
  it("USD display does not need rates", () => {
    assert.equal(displayCurrencyNeedsRates("USD"), false);
  });

  it("non-USD display needs rates", () => {
    assert.equal(displayCurrencyNeedsRates("EUR"), true);
    assert.equal(displayCurrencyNeedsRates("BTC"), true);
  });

  it("enables rates for non-USD display or ephemeral requests", () => {
    assert.equal(
      shouldEnableMarketRates({ displayCurrencyNeedsRates: false, ephemeralRequests: 0 }),
      false,
    );
    assert.equal(
      shouldEnableMarketRates({ displayCurrencyNeedsRates: true, ephemeralRequests: 0 }),
      true,
    );
    assert.equal(
      shouldEnableMarketRates({ displayCurrencyNeedsRates: false, ephemeralRequests: 1 }),
      true,
    );
  });
});
