/**
 * SVM testnet min-stake pin (SPEC §13.10 / S5).
 *
 * Sole owner of the stated Solana testnet stake floor used by stand + Devnet
 * deploy. Join never quotes FX.
 *
 * On non-EVM testnet the minimum may be a **stated constant** of the same order
 * as the declared ETH weight — not an FX observation. Mainnet must derive from
 * an observed on-chain rate (source + address/slot + timestamp) and re-pin every
 * redeploy.
 */

import { DECLARED_MIN_STAKE_FLOOR_WEI, DECLARED_MIN_STAKE_NATIVE_WEI } from "./declared-weights";

/** Stated testnet min stake — same order as declared 0.05 ETH; not a rate product. */
export const TESTNET_MIN_STAKE_LAMPORTS = 500_000_000n;

/** Stated testnet floor — same order as declared 0.001 ETH. */
export const TESTNET_MIN_STAKE_FLOOR_LAMPORTS = 10_000_000n;

export const TESTNET_MIN_STAKE_DECLARED_AT = "2026-08-30";

export const TESTNET_MIN_STAKE_SOURCE =
  "stated testnet constant (same order as declared 0.05 ETH weight; not an FX observation)";

/** Stated testnet min stake lamports. */
export function testnetMinStakeLamports(): bigint {
  return TESTNET_MIN_STAKE_LAMPORTS;
}

/** Stated testnet floor lamports. */
export function testnetMinStakeFloorLamports(): bigint {
  return TESTNET_MIN_STAKE_FLOOR_LAMPORTS;
}

export type MinStakePinRecord = {
  kind: "stated_testnet_constant";
  declaredEthWeightWei: string;
  declaredEthFloorWei: string;
  solLamports: string;
  floorLamports: string;
  source: string;
  declaredAt: string;
};

export function testnetMinStakePinRecord(): MinStakePinRecord {
  return {
    kind: "stated_testnet_constant",
    declaredEthWeightWei: DECLARED_MIN_STAKE_NATIVE_WEI.toString(),
    declaredEthFloorWei: DECLARED_MIN_STAKE_FLOOR_WEI.toString(),
    solLamports: TESTNET_MIN_STAKE_LAMPORTS.toString(),
    floorLamports: TESTNET_MIN_STAKE_FLOOR_LAMPORTS.toString(),
    source: TESTNET_MIN_STAKE_SOURCE,
    declaredAt: TESTNET_MIN_STAKE_DECLARED_AT,
  };
}
