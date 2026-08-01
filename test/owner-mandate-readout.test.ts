import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

import { computeAgentedSplit } from "@/lib/commerce/agented-split";
import {
  COMMISSION_FORM_DEF,
  MARGIN_FORM_DEF,
} from "@/lib/commerce/compensation-form";
import { COMPENSATION_FORM } from "@/lib/commerce/denomination";
import {
  COMMISSION_PROCEEDS_MOVES_WITH_PRICE,
  commissionRateLabel,
  deriveOwnerMandateReadout,
} from "@/lib/commerce/owner-mandate-readout";

const ROOT = join(import.meta.dirname, "..");

const USD_UNITS = { decimals: 8, unitLabel: "USD" } as const;
const ETH_UNITS = { decimals: 18, unitLabel: "ETH" } as const;

describe("commissionRateLabel", () => {
  it("formats whole and fractional percents from bps", () => {
    assert.equal(commissionRateLabel(500), "5%");
    assert.equal(commissionRateLabel(250), "2.5%");
    assert.equal(commissionRateLabel(1), "0.01%");
  });
});

describe("deriveOwnerMandateReadout — Margin", () => {
  it("shows form and floor; proceeds are fixed with form ownerReceives", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Margin,
      commissionBps: 0,
      floor: 10_000_000_000n, // 100 USD 1e8
      units: USD_UNITS,
      settled: 20_000_000_000n,
      platformFeeBps: 250,
      mode: "fixedPrice",
    });
    assert.equal(readout.formLabel, MARGIN_FORM_DEF.label);
    assert.equal(readout.rateLabel, null);
    assert.equal(readout.floorLabel, "100 USD");
    assert.equal(readout.ownerReceives, MARGIN_FORM_DEF.ownerReceives);
    assert.deepEqual(readout.proceeds, {
      kind: "fixed",
      statement: MARGIN_FORM_DEF.ownerReceives,
    });
  });

  it("omits floor label when units are unresolved", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Margin,
      commissionBps: 0,
      floor: 1n,
      units: null,
    });
    assert.equal(readout.floorLabel, null);
    assert.equal(readout.proceeds.kind, "fixed");
  });

  it("never computes a variable proceeds figure even with settled price", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Margin,
      commissionBps: 0,
      floor: 1n * 10n ** 18n,
      units: ETH_UNITS,
      settled: 2n * 10n ** 18n,
      platformFeeBps: 250,
      mode: "fixedPrice",
    });
    assert.equal(readout.proceeds.kind, "fixed");
  });
});

describe("deriveOwnerMandateReadout — Commission terms", () => {
  it("includes form, rate, and floor", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 50_000_000_000n,
      units: USD_UNITS,
    });
    assert.equal(readout.formLabel, COMMISSION_FORM_DEF.label);
    assert.equal(readout.rateLabel, "5%");
    assert.equal(readout.floorLabel, "500 USD");
    assert.equal(readout.ownerReceives, COMMISSION_FORM_DEF.ownerReceives);
    assert.equal(readout.proceeds.kind, "absent");
  });
});

describe("deriveOwnerMandateReadout — Commission proceeds", () => {
  it("presents variable owner amount on FixedPrice when settled and fee known", () => {
    // Settled 1000 USD, floor 100 USD, commission 5%, platform 2.5%.
    const S = 100_000_000_000n;
    const f = 10_000_000_000n;
    const fee = 250;
    const bps = 500;
    const expected = computeAgentedSplit({
      settled: S,
      floor: f,
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: bps,
      platformFeeBps: BigInt(fee),
    });
    assert.equal(expected.ok, true);

    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: bps,
      floor: f,
      units: USD_UNITS,
      settled: S,
      platformFeeBps: fee,
      mode: "fixedPrice",
    });
    assert.equal(readout.proceeds.kind, "variable");
    if (readout.proceeds.kind !== "variable") return;
    assert.equal(readout.proceeds.ownerAmount, expected.ownerAmount);
    assert.match(readout.proceeds.amountLabel, /USD$/);
    assert.equal(
      readout.proceeds.movesWithPrice,
      COMMISSION_PROCEEDS_MOVES_WITH_PRICE,
    );
    assert.match(
      readout.proceeds.movesWithPrice,
      /listed price, which you do not set/,
    );
  });

  it("is absent without a settled amount (awaiting mandate)", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 10_000_000_000n,
      units: USD_UNITS,
      mode: "fixedPrice",
    });
    assert.equal(readout.proceeds.kind, "absent");
  });

  it("shows variable Commission proceeds on Ascending against the bid level (S31)", () => {
    const settled = 2n * 10n ** 18n;
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 1n * 10n ** 18n,
      units: ETH_UNITS,
      settled,
      platformFeeBps: 250,
      mode: "ascending",
    });
    assert.equal(readout.proceeds.kind, "variable");
    if (readout.proceeds.kind !== "variable") return;
    const expected = computeAgentedSplit({
      settled,
      floor: 1n * 10n ** 18n,
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      platformFeeBps: 250n,
    });
    assert.equal(readout.proceeds.ownerAmount, expected.ownerAmount);
    assert.match(readout.proceeds.movesWithPrice, /winning bid/i);
    assert.equal(readout.rateLabel, "5%");
  });

  it("is absent when platform fee is unread", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 10_000_000_000n,
      units: USD_UNITS,
      settled: 100_000_000_000n,
      platformFeeBps: null,
      mode: "fixedPrice",
    });
    assert.equal(readout.proceeds.kind, "absent");
  });

  it("is absent when display units are unresolved", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 10_000_000_000n,
      units: null,
      settled: 100_000_000_000n,
      platformFeeBps: 250,
      mode: "fixedPrice",
    });
    assert.equal(readout.floorLabel, null);
    assert.equal(readout.proceeds.kind, "absent");
  });

  it("is absent when the split fails the floor check", () => {
    const readout = deriveOwnerMandateReadout({
      compensationForm: COMPENSATION_FORM.Commission,
      commissionBps: 500,
      floor: 100_000_000_000n, // 1000 USD
      units: USD_UNITS,
      settled: 10_000_000_000n, // 100 USD — too low
      platformFeeBps: 250,
      mode: "fixedPrice",
    });
    assert.equal(readout.proceeds.kind, "absent");
  });
});

describe("owner mandate readout policy — delegated tab consumes pure module", () => {
  it("delegated-vehicles-tab imports deriveOwnerMandateReadout and OwnerMandateTerms", () => {
    const src = readFileSync(
      join(ROOT, "components/profile/delegated-vehicles-tab.tsx"),
      "utf8",
    );
    assert.match(src, /deriveOwnerMandateReadout/);
    assert.match(src, /OwnerMandateTerms/);
    assert.doesNotMatch(src, /SellerNetCalculator/);
  });

  it("OwnerMandateTerms does not restate compensation form meaning", () => {
    const src = readFileSync(
      join(ROOT, "components/commerce/owner-mandate-terms.tsx"),
      "utf8",
    );
    assert.doesNotMatch(src, /exactly your floor/);
    assert.doesNotMatch(src, /commission rate you grant/);
  });
});
