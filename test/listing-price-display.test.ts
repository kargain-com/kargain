import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

import { DENOMINATION_KIND } from "../lib/commerce/denomination.ts";
import {
  askingAssetAmountToUsd1e8,
  askingNativeDecimals,
  askingPriceInputUnit,
  askingSettlementDisclosure,
  askingUsdcFacts,
  deriveListingAskingPrice,
  formatListingAssetAsking,
  toAskingDisplaySource,
} from "../lib/commerce/listing-price-display.ts";
import { FIAT_SCALE } from "../lib/marketplace/price-normalize.ts";
import { COMMERCIAL_ACTIVE } from "../lib/web3/commercial-active.ts";

const BASE = 84532;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ZERO = "0x0000000000000000000000000000000000000000";
const ROOT = join(import.meta.dirname, "..");

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
      assert.equal(asking.identity, "usdc");
      assert.equal(
        formatListingAssetAsking(asking.amount, asking.decimals, asking.unitLabel),
        "350,000 USDC",
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

describe("toAskingDisplaySource", () => {
  it("pegs USDC asset asking to USD 1e8 for convertPrice", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 350000000000n,
      asset: USDC,
      chainId: BASE,
    });
    const source = toAskingDisplaySource(asking);
    assert.ok(source);
    assert.equal(source!.listingCurrency, 0);
    assert.equal(source!.amount1e8, 350_000n * FIAT_SCALE);
    assert.equal(
      askingAssetAmountToUsd1e8(350000000000n, 6, "usdc"),
      350_000n * FIAT_SCALE,
    );
  });

  it("converts native asset asking via ethUsd1e8", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 10n ** 18n, // 1 ETH
      asset: ZERO,
      chainId: BASE,
    });
    const ethUsd = 2500n * FIAT_SCALE;
    const source = toAskingDisplaySource(asking, { ethUsd1e8: ethUsd });
    assert.ok(source);
    assert.equal(source!.amount1e8, ethUsd);
    assert.equal(source!.listingCurrency, 0);
  });

  it("returns null for native without eth rate", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 10n ** 18n,
      asset: ZERO,
      chainId: BASE,
    });
    assert.equal(toAskingDisplaySource(asking), null);
    assert.equal(toAskingDisplaySource(asking, { ethUsd1e8: null }), null);
  });

  it("returns null for unknown asset identity", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Asset,
      price: 1000n,
      asset: "0x2222222222222222222222222222222222222222",
      chainId: BASE,
      erc20Decimals: 18,
    });
    assert.equal(asking.status, "asset");
    if (asking.status === "asset") {
      assert.equal(asking.identity, "unknown");
    }
    assert.equal(toAskingDisplaySource(asking), null);
  });

  it("passes fiat asking through for convertPrice", () => {
    const asking = deriveListingAskingPrice({
      denominationKind: DENOMINATION_KIND.Fiat,
      price: 100n * FIAT_SCALE,
      currencyCode: "EUR",
      asset: ZERO,
      chainId: BASE,
    });
    const source = toAskingDisplaySource(asking);
    assert.ok(source);
    assert.equal(source!.amount1e8, 100n * FIAT_SCALE);
    assert.equal(source!.listingCurrency, 1); // EUR
  });
});

describe("askingUsdcFacts", () => {
  it("covers every COMMERCIAL_ACTIVE USDC address with USDC identity decimals", () => {
    const facts = askingUsdcFacts();
    const committed = Object.values(COMMERCIAL_ACTIVE).map((s) =>
      s.usdc.toLowerCase(),
    );
    assert.deepEqual(
      facts.map((f) => f.address.toLowerCase()).sort(),
      [...committed].sort(),
    );
    for (const fact of facts) {
      assert.equal(fact.decimals, 6);
      assert.equal(
        COMMERCIAL_ACTIVE[fact.chainId]?.usdc.toLowerCase(),
        fact.address.toLowerCase(),
      );
    }
    assert.equal(askingNativeDecimals(), 18);
  });
});

describe("askingSettlementDisclosure", () => {
  it("formats sole settlement disclosure copy", () => {
    assert.equal(
      askingSettlementDisclosure("USDC"),
      "Checkout settles in USDC.",
    );
    assert.equal(
      askingSettlementDisclosure("ETH"),
      "Checkout settles in ETH.",
    );
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

describe("listing asking display policy", () => {
  it("chrome consumes disclosure owner; buy panel does not fork Checkout settles copy", () => {
    const owner = readFileSync(
      join(ROOT, "lib/commerce/listing-price-display.ts"),
      "utf8",
    );
    assert.match(owner, /askingSettlementDisclosure/);
    assert.match(owner, /Checkout settles in/);

    const chrome = readFileSync(
      join(ROOT, "components/marketplace/listing-display-price.tsx"),
      "utf8",
    );
    assert.match(chrome, /askingSettlementDisclosure/);
    assert.match(chrome, /toAskingDisplaySource/);
    assert.match(chrome, /convertPrice/);

    const buy = readFileSync(
      join(ROOT, "components/marketplace/listing-buy-panel.tsx"),
      "utf8",
    );
    assert.doesNotMatch(buy, /Checkout settles/);
    assert.match(buy, /formatListingAssetAsking/);
    assert.match(buy, /ListingDisplayPrice/);
  });
});
