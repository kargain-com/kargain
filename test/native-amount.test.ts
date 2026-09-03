/**
 * S8-4 — native amount owner behaviour (unit from CommercialNativeUnit).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMERCIAL_ACTIVE,
  nativeUnitOf,
} from "../lib/web3/commercial-active.ts";
import {
  formatNativeAmount,
  formatNativeAmountLabeled,
  nativeAmountScale,
  parseNativeAmount,
} from "../lib/web3/native-amount.ts";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";

const ethUnit = nativeUnitOf(COMMERCIAL_ACTIVE[84532]!);
const solUnit = nativeUnitOf(FIXTURE_SVM_STACK);

describe("nativeAmountScale", () => {
  it("matches unit decimals", () => {
    assert.equal(nativeAmountScale(ethUnit), 10n ** 18n);
    assert.equal(nativeAmountScale(solUnit), 10n ** 9n);
  });
});

describe("parseNativeAmount / formatNativeAmount", () => {
  it("round-trips under ETH/18", () => {
    const wei = parseNativeAmount("1.5", ethUnit);
    assert.equal(wei, 1_500_000_000_000_000_000n);
    assert.equal(formatNativeAmount(wei!, ethUnit), "1.5");
  });

  it("round-trips under SOL/9", () => {
    const lamports = parseNativeAmount("1.5", solUnit);
    assert.equal(lamports, 1_500_000_000n);
    assert.equal(formatNativeAmount(lamports!, solUnit), "1.5");
  });

  it("same integer base units format differently under 9 vs 18 (unit not unused)", () => {
    const amount = 1_500_000_000n;
    const underNine = formatNativeAmount(amount, solUnit);
    const underEighteen = formatNativeAmount(amount, ethUnit);
    assert.equal(underNine, "1.5");
    assert.equal(underEighteen, "0.0000000015");
    assert.notEqual(underNine, underEighteen);
  });

  it("labeled includes symbol from unit", () => {
    assert.equal(
      formatNativeAmountLabeled(1_000_000_000_000_000_000n, ethUnit),
      "1 ETH",
    );
    assert.equal(
      formatNativeAmountLabeled(1_000_000_000n, solUnit),
      "1 SOL",
    );
  });

  it("fixedFractionDigits matches stake-style readout", () => {
    assert.equal(
      formatNativeAmount(50_000_000_000_000_000n, ethUnit, {
        fixedFractionDigits: 2,
      }),
      "0.05",
    );
  });

  it("empty / invalid parse → null", () => {
    assert.equal(parseNativeAmount("", ethUnit), null);
    assert.equal(parseNativeAmount("  ", solUnit), null);
    assert.equal(parseNativeAmount("abc", ethUnit), null);
  });
});
