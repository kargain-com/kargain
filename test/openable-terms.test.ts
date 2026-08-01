import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPENSATION_FORM,
  DENOMINATION_KIND,
} from "../lib/commerce/denomination.ts";
import {
  ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON,
  ASCENDING_MODE_UNAVAILABLE_REASON,
  COMMERCE_CONFIG_UNRESOLVED_REASON,
  FIAT_TOKEN_FEED_REQUIRED_REASON,
  FIXED_PRICE_MODE_UNAVAILABLE_REASON,
  assetAllowsFiat,
  compensationFormAvailable,
  deriveOpenableTerms,
  fiatUnavailableReasonForAsset,
  gateOpenablePairing,
} from "../lib/commerce/openable-terms.ts";
import {
  COMMISSION_FORM_DEF,
  EXTERNAL_PAYMENT_GRANT_DISCLOSURE,
  MARGIN_FORM_DEF,
  buildCompensation,
  compensationFormDef,
} from "../lib/commerce/compensation-form.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ZERO = "0x0000000000000000000000000000000000000000";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const FEED = "0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E";

describe("deriveOpenableTerms", () => {
  it("refuses when the FixedPrice mode is unavailable — reason, not empty controls", () => {
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: false,
      configResolved: true,
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
    assert.deepEqual(opts.compensationForms, []);
  });

  it("fail-closed when config is unresolved — distinct from mode unavailable", () => {
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: false,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    });
    assert.equal(opts.available, false);
    assert.equal(opts.unavailableReason, COMMERCE_CONFIG_UNRESOLVED_REASON);
    assert.notEqual(
      opts.unavailableReason,
      FIXED_PRICE_MODE_UNAVAILABLE_REASON,
    );
    assert.deepEqual(opts.assets, []);
  });

  it("always offers native with Asset and Fiat; Asset for every admitted token", () => {
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: true,
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
    assert.equal(opts.assets[2]?.fiatDenomination, false);
    assert.equal(
      opts.assets[2]?.fiatUnavailableReason,
      FIAT_TOKEN_FEED_REQUIRED_REASON,
    );
  });

  it("offers both compensation forms when terms are available", () => {
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    });
    assert.equal(compensationFormAvailable(opts, COMPENSATION_FORM.Margin), true);
    assert.equal(
      compensationFormAvailable(opts, COMPENSATION_FORM.Commission),
      true,
    );
    assert.equal(opts.compensationForms.length, 2);
  });

  it("ascending: asset denomination only; fiat blocked with N4/P1 cause", () => {
    const opts = deriveOpenableTerms({
      mode: "ascending",
      modeAvailable: true,
      configResolved: true,
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
    assert.equal(opts.available, true);
    assert.deepEqual(opts.fiatCurrencyCodes, []);
    for (const asset of opts.assets) {
      assert.equal(asset.fiatDenomination, false);
      assert.equal(
        asset.fiatUnavailableReason,
        ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON,
      );
    }
    assert.equal(assetAllowsFiat(opts, USDC), false);
    assert.equal(
      fiatUnavailableReasonForAsset(opts, USDC),
      ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON,
    );
  });

  it("ascending mode unavailable has ascending copy", () => {
    const opts = deriveOpenableTerms({
      mode: "ascending",
      modeAvailable: false,
      configResolved: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    });
    assert.equal(opts.unavailableReason, ASCENDING_MODE_UNAVAILABLE_REASON);
  });

  it("includes USD always and non-USD only with a live currency feed", () => {
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: true,
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
    const opts = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: true,
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

describe("gateOpenablePairing", () => {
  const fixed = deriveOpenableTerms({
    mode: "fixedPrice",
    modeAvailable: true,
    configResolved: true,
    native: { label: "ETH", decimals: 18 },
    paymentTokens: [
      {
        token: USDC,
        feed: "",
        decimals: 6,
        active: true,
        label: "USDC",
      },
    ],
    currencyFeeds: [],
  });

  it("refuses fiat × feedless ERC-20 with PaymentTokenFeedRequired cause", () => {
    const gate = gateOpenablePairing(fixed, {
      asset: USDC,
      denominationKind: DENOMINATION_KIND.Fiat,
      currencyCode: "USD",
    });
    assert.equal(gate.available, false);
    if (!gate.available) {
      assert.equal(gate.cause, FIAT_TOKEN_FEED_REQUIRED_REASON);
    }
  });

  it("allows asset denomination on feedless ERC-20", () => {
    const gate = gateOpenablePairing(fixed, {
      asset: USDC,
      denominationKind: DENOMINATION_KIND.Asset,
    });
    assert.equal(gate.available, true);
  });

  it("refuses ascending × fiat with asset-denomination cause", () => {
    const ascending = deriveOpenableTerms({
      mode: "ascending",
      modeAvailable: true,
      configResolved: true,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    });
    const gate = gateOpenablePairing(ascending, {
      asset: ZERO,
      denominationKind: DENOMINATION_KIND.Fiat,
      currencyCode: "USD",
    });
    assert.equal(gate.available, false);
    if (!gate.available) {
      assert.equal(gate.cause, ASCENDING_ASSET_DENOMINATION_REQUIRED_REASON);
    }
  });

  it("refuses when terms unavailable with the same named cause", () => {
    const unresolved = deriveOpenableTerms({
      mode: "fixedPrice",
      modeAvailable: true,
      configResolved: false,
      native: { label: "ETH", decimals: 18 },
      paymentTokens: [],
      currencyFeeds: [],
    });
    const gate = gateOpenablePairing(unresolved, {
      asset: ZERO,
      denominationKind: DENOMINATION_KIND.Asset,
    });
    assert.equal(gate.available, false);
    if (!gate.available) {
      assert.equal(gate.cause, COMMERCE_CONFIG_UNRESOLVED_REASON);
    }
  });
});

describe("compensation form meaning", () => {
  it("defines margin consequence: owner receives exactly the floor", () => {
    assert.match(MARGIN_FORM_DEF.consequence, /exactly your floor/i);
    assert.match(MARGIN_FORM_DEF.agentReceives, /everything above/i);
    assert.equal(
      compensationFormDef(COMPENSATION_FORM.Margin).consequence,
      MARGIN_FORM_DEF.consequence,
    );
  });

  it("defines commission consequence: agent rate, owner remainder", () => {
    assert.match(COMMISSION_FORM_DEF.consequence, /commission rate/i);
    assert.match(COMMISSION_FORM_DEF.consequence, /remainder/i);
    assert.equal(
      compensationFormDef(COMPENSATION_FORM.Commission).consequence,
      COMMISSION_FORM_DEF.consequence,
    );
  });

  it("buildCompensation: Margin zeros commissionBps; Commission preserves bps", () => {
    const margin = buildCompensation({ form: COMPENSATION_FORM.Margin });
    assert.ok(!("ok" in margin));
    assert.equal(margin.form, COMPENSATION_FORM.Margin);
    assert.equal(margin.commissionBps, 0);

    const commission = buildCompensation({
      form: COMPENSATION_FORM.Commission,
      commissionPercent: "5",
    });
    assert.ok(!("ok" in commission));
    assert.equal(commission.form, COMPENSATION_FORM.Commission);
    assert.equal(commission.commissionBps, 500);
  });

  it("external-payment grant disclosure is a single owned constant", () => {
    assert.match(EXTERNAL_PAYMENT_GRANT_DISCLOSURE, /off-protocol/i);
    assert.match(EXTERNAL_PAYMENT_GRANT_DISCLOSURE, /floor/i);
  });
});

describe("openable terms / grant form policy", () => {
  const PANEL = path.join(
    ROOT,
    "components/marketplace/listing-seller-settlement-panel.tsx",
  );
  const EDIT = path.join(
    ROOT,
    "components/marketplace/listing-edit-client.tsx",
  );
  const GRANT_FP = path.join(
    ROOT,
    "components/marketplace/authorize-agent-dialog.tsx",
  );
  const GRANT_ASC = path.join(
    ROOT,
    "components/auction/authorize-auction-agent-dialog.tsx",
  );
  const CREATE_ASC = path.join(
    ROOT,
    "components/auction/create-auction-panel.tsx",
  );
  const COMP_FIELDS = path.join(
    ROOT,
    "components/commerce/mandate-compensation-fields.tsx",
  );

  it("form surfaces do not embed chain id or token address literals", () => {
    for (const file of [PANEL, EDIT, GRANT_FP, GRANT_ASC, CREATE_ASC]) {
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

  it("grant dialogs consume openable terms and compensation definitions", () => {
    for (const file of [GRANT_FP, GRANT_ASC]) {
      const text = fs.readFileSync(file, "utf8");
      assert.match(text, /useOpenableTerms|gateOpenablePairing/);
      assert.match(text, /MandateCompensationFields|compensationFormDef/);
      assert.doesNotMatch(
        text,
        /form:\s*COMPENSATION_FORM\.Margin,\s*commissionBps:\s*0\s*\}\s*,?\s*\]/,
        `${path.basename(file)} must not hard-wire Margin-only grant args`,
      );
    }
    const fp = fs.readFileSync(GRANT_FP, "utf8");
    assert.match(fp, /EXTERNAL_PAYMENT_GRANT_DISCLOSURE/);
    assert.doesNotMatch(fp, /CURRENCY_CODE_USD/);
  });

  it("compensation fields derive consequence from form definitions", () => {
    const text = fs.readFileSync(COMP_FIELDS, "utf8");
    assert.match(text, /compensationFormDef|COMPENSATION_FORM_DEFS/);
    assert.doesNotMatch(
      text,
      /exactly your floor|commission rate you grant/,
      "component must not invent money-consequence copy",
    );
  });

  it("settlement panel consumes derived openable terms", () => {
    const text = fs.readFileSync(PANEL, "utf8");
    assert.match(
      text,
      /OpenableTerms|openOptions/,
      "panel must take resolver options as props",
    );
  });

  it("create auction consumes openable terms — no ETH/USDC assetKind toggle", () => {
    const text = fs.readFileSync(CREATE_ASC, "utf8");
    assert.match(text, /useOpenableTerms/);
    assert.doesNotMatch(text, /assetKind|"ETH"\s*\|\s*"USDC"/);
    assert.doesNotMatch(text, /usdcAddress/);
  });
});
