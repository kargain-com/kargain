import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECLARED_MIN_STAKE_NATIVE_WEI } from "../lib/web3/declared-weights.ts";
import {
  ethWeiToLamports,
  standMinStakeFloorLamports,
  standMinStakeLamports,
  standMinStakePinRecord,
  STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR,
  STAND_MIN_STAKE_RATE_DATE,
} from "../lib/web3/min-stake-sol.ts";

describe("min-stake-sol (S5 pin-at-deploy)", () => {
  it("stand fixture: 0.05 ETH × 10 SOL/ETH = 0.5 SOL lamports", () => {
    assert.equal(STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR, 10n);
    assert.equal(standMinStakeLamports(), 500_000_000n);
    assert.equal(
      ethWeiToLamports(DECLARED_MIN_STAKE_NATIVE_WEI, 10n),
      500_000_000n,
    );
  });

  it("floor is smaller than min", () => {
    assert.ok(standMinStakeFloorLamports() < standMinStakeLamports());
    assert.equal(standMinStakeFloorLamports(), 10_000_000n);
  });

  it("pin record carries rate date and source", () => {
    const pin = standMinStakePinRecord();
    assert.equal(pin.rateDate, STAND_MIN_STAKE_RATE_DATE);
    assert.match(pin.source, /stand-fixture/);
    assert.equal(pin.ethWeightWei, DECLARED_MIN_STAKE_NATIVE_WEI.toString());
  });

  it("refuses non-positive rate", () => {
    assert.throws(() => ethWeiToLamports(1n, 0n), /solPerEth/);
  });
});
