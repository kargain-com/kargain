import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECLARED_MIN_STAKE_NATIVE_WEI } from "../lib/web3/declared-weights.ts";
import {
  TESTNET_MIN_STAKE_DECLARED_AT,
  TESTNET_MIN_STAKE_FLOOR_LAMPORTS,
  TESTNET_MIN_STAKE_LAMPORTS,
  testnetMinStakeFloorLamports,
  testnetMinStakeLamports,
  testnetMinStakePinRecord,
} from "../lib/web3/min-stake-sol.ts";

describe("min-stake-sol (S5 stated testnet constant)", () => {
  it("pins stated 500_000_000 lamports (not an FX product)", () => {
    assert.equal(TESTNET_MIN_STAKE_LAMPORTS, 500_000_000n);
    assert.equal(testnetMinStakeLamports(), 500_000_000n);
  });

  it("floor is smaller than min", () => {
    assert.ok(testnetMinStakeFloorLamports() < testnetMinStakeLamports());
    assert.equal(testnetMinStakeFloorLamports(), TESTNET_MIN_STAKE_FLOOR_LAMPORTS);
    assert.equal(TESTNET_MIN_STAKE_FLOOR_LAMPORTS, 10_000_000n);
  });

  it("pin record is stated_testnet_constant with declared-weight reference", () => {
    const pin = testnetMinStakePinRecord();
    assert.equal(pin.kind, "stated_testnet_constant");
    assert.equal(pin.declaredAt, TESTNET_MIN_STAKE_DECLARED_AT);
    assert.match(pin.source, /stated testnet constant/);
    assert.match(pin.source, /not an FX observation/);
    assert.equal(pin.declaredEthWeightWei, DECLARED_MIN_STAKE_NATIVE_WEI.toString());
    assert.equal(pin.solLamports, "500000000");
    assert.equal(pin.floorLamports, "10000000");
    assert.equal("solPerEth" in pin, false);
  });
});
