import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIAT_TOKEN_FEED_REQUIRED_REASON,
  FIXED_PRICE_MODE_UNAVAILABLE_REASON,
  assetAllowsFiat,
  deriveFixedPriceOpenOptions,
  fiatUnavailableReasonForAsset,
} from "../lib/commerce/fixed-price-open-options.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FEED = "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E";

describe("deriveFixedPriceOpenOptions", () => {
  it("refuses when the FixedPrice mode is unavailable — reason, not empty controls", () => {
    const opts = deriveFixedPriceOpenOptions({
      modeAvailable: false,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [
        {
          token: USDC,
          feed: FEED,
          decimals: 6,
          active: true,
          label: "USDC",
        },
      ],
      currencyFeeds: [{ currencyCode: "EUR", feed: FEED }],
    });
    assert.equal(opts.available, false);
    assert.equal(opts.unavailableReason, FIXED_PRICE_MODE_UNAVAILABLE_REASON);
    assert.deepEqual(opts.assets, []);
    assert.deepEqual(opts.fiatCurrencyCodes, []);
  });

  it("always offers native with Asset and Fiat; Asset for every admitted token", () => {
    const opts = deriveFixedPriceOpenOptions({
      modeAvailable: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [
        {
          token: USDC,
          feed: FEED,
          decimals: 6,
          active: true,
          label: "USDC",
        },
        {
          token: "0x1111111111111111111111111111111111111111",
          feed: "",
          decimals: 18,
          active: true,
          label: "FEEDLESS",
        },
      ],
      currencyFeeds: [],
    });
    assert.equal(opts.available, true);
    assert.equal(opts.assets.length, 3);
    assert.equal(opts.assets[0]?.token, ZERO);
    assert.equal(opts.assets[0]?.fiatDenomination, true);
    assert.equal(opts.assets[0]?.assetDenomination, true);
    assert.equal(opts.assets[1]?.fiatDenomination, true);
    assert.equal(opts.assets[1]?.assetDenomination, true);
    assert.equal(opts.assets[2]?.fiatDenomination, false);
    assert.equal(opts.assets[2]?.assetDenomination, true);
    assert.equal(
      opts.assets[2]?.fiatUnavailableReason,
      FIAT_TOKEN_FEED_REQUIRED_REASON,
    );
  });

  it("offers fiat denomination in a token only when that token has a feed", () => {
    const withFeed = deriveFixedPriceOpenOptions({
      modeAvailable: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [
        {
          token: USDC,
          feed: FEED,
          decimals: 6,
          active: true,
          label: "USDC",
        },
      ],
      currencyFeeds: [],
    });
    assert.equal(assetAllowsFiat(withFeed, USDC), true);
    assert.equal(fiatUnavailableReasonForAsset(withFeed, USDC), undefined);

    const feedless = deriveFixedPriceOpenOptions({
      modeAvailable: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [
        {
          token: USDC,
          feed: ZERO,
          decimals: 6,
          active: true,
          label: "USDC",
        },
      ],
      currencyFeeds: [],
    });
    assert.equal(assetAllowsFiat(feedless, USDC), false);
    assert.equal(
      fiatUnavailableReasonForAsset(feedless, USDC),
      FIAT_TOKEN_FEED_REQUIRED_REASON,
    );
  });

  it("includes USD always and non-USD only with a live currency feed", () => {
    const opts = deriveFixedPriceOpenOptions({
      modeAvailable: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [
        { currencyCode: "eur", feed: FEED },
        { currencyCode: "GBP", feed: ZERO },
        { currencyCode: "JPY", feed: "" },
        { currencyCode: "CAD", feed: FEED },
      ],
    });
    assert.deepEqual(opts.fiatCurrencyCodes, ["USD", "EUR", "CAD"]);
  });

  it("skips inactive payment tokens and zero-address token rows", () => {
    const opts = deriveFixedPriceOpenOptions({
      modeAvailable: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [
        {
          token: USDC,
          feed: FEED,
          decimals: 6,
          active: false,
          label: "USDC",
        },
        {
          token: ZERO,
          feed: FEED,
          decimals: 18,
          active: true,
          label: "bogus-native",
        },
      ],
      currencyFeeds: [],
    });
    assert.equal(opts.assets.length, 1);
    assert.equal(opts.assets[0]?.token, ZERO);
  });
});

describe("fixed-price open form policy", () => {
  const PANEL = path.join(
    ROOT,
    "components/marketplace/listing-seller-settlement-panel.tsx",
  );
  const EDIT = path.join(
    ROOT,
    "components/marketplace/listing-edit-client.tsx",
  );

  it("form surfaces do not embed chain id or token address literals", () => {
    for (const file of [PANEL, EDIT]) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(
        text,
        /\b84532\b|\b11155111\b|\b8453\b/,
        `${path.basename(file)} must not hardcode commercial chain ids`,
      );
      assert.doesNotMatch(
        text,
        /0x[a-fA-F0-9]{40}/,
        `${path.basename(file)} must not hardcode token addresses`,
      );
      assert.doesNotMatch(
        text,
        /listingCurrencyCodesForChain/,
        `${path.basename(file)} must not use the static per-chain currency map`,
      );
    }
  });

  it("settlement panel consumes derived open options", () => {
    const text = fs.readFileSync(PANEL, "utf8");
    assert.match(
      text,
      /FixedPriceOpenOptions|openOptions/,
      "panel must take resolver options as props",
    );
  });
});
