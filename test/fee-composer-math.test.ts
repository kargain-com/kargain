import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeTotalFeeWei,
  deriveMarginWeiFromOnChain,
  displayAmountToFeeWei,
  formatFeeWeiEth,
  formatFeeWeiInDisplayCurrency,
  parseEthAmountToWei,
} from "../lib/verifier/fee-composer-math.ts";
import { ETH_SCALE, FIAT_SCALE } from "../lib/marketplace/price-normalize.ts";

const ETH_USD = 300_000_000_000n; // $3000 at 1e8

describe("parseEthAmountToWei", () => {
  it("parses whole and fractional ETH", () => {
    assert.equal(parseEthAmountToWei("1"), ETH_SCALE);
    assert.equal(parseEthAmountToWei("0.1"), ETH_SCALE / 10n);
  });

  it("rounds up extra fractional digits", () => {
    assert.equal(parseEthAmountToWei("0.0000000000000000011"), 2n);
  });

  it("returns null for invalid input", () => {
    assert.equal(parseEthAmountToWei("abc"), null);
    assert.equal(parseEthAmountToWei("-1"), null);
  });
});

describe("displayAmountToFeeWei", () => {
  it("returns zero for empty or zero", () => {
    assert.equal(displayAmountToFeeWei("", "USD", {}), 0n);
    assert.equal(displayAmountToFeeWei("0", "ETH", {}), 0n);
  });

  it("converts USD to wei with round-up", () => {
    const wei = displayAmountToFeeWei("3000", "USD", { ethUsd: ETH_USD });
    assert.equal(wei, ETH_SCALE);
  });

  it("returns null when ethUsd missing for fiat", () => {
    assert.equal(displayAmountToFeeWei("100", "USD", {}), null);
  });
});

describe("formatFeeWeiInDisplayCurrency", () => {
  it("formats ETH display without suffix", () => {
    assert.equal(formatFeeWeiInDisplayCurrency(ETH_SCALE, "ETH", {}), "1");
  });

  it("formats USD from wei", () => {
    const label = formatFeeWeiInDisplayCurrency(ETH_SCALE, "USD", { ethUsd: ETH_USD });
    assert.match(label ?? "", /\$3,000\.00/);
  });
});

describe("composeTotalFeeWei", () => {
  it("adds margin and gas", () => {
    assert.equal(composeTotalFeeWei(100n, 50n), 150n);
  });

  it("zero margin yields zero total", () => {
    assert.equal(composeTotalFeeWei(0n, 50n), 0n);
  });
});

describe("deriveMarginWeiFromOnChain", () => {
  it("subtracts gas when available", () => {
    assert.equal(deriveMarginWeiFromOnChain(150n, 50n), 100n);
  });

  it("returns on-chain fee when gas unknown", () => {
    assert.equal(deriveMarginWeiFromOnChain(150n, null), 150n);
  });
});

describe("formatFeeWeiEth", () => {
  it("includes ETH suffix", () => {
    assert.equal(formatFeeWeiEth(ETH_SCALE), "1 ETH");
  });
});
