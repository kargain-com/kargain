/**
 * Declared ETH→SOL min-stake conversion for SVM deploy (SPEC §13.10 / S5).
 *
 * Join never quotes FX. Lamports are pinned once at deploy into staking config.
 * Mainnet must re-pin on every redeploy — SOL weight drifts from ETH over time.
 *
 * Sole owner of the stand/Devnet conversion helper; consumers import.
 */

import { DECLARED_MIN_STAKE_FLOOR_WEI, DECLARED_MIN_STAKE_NATIVE_WEI } from "./declared-weights.ts";

/** Stand fixture rate — not a live oracle. 1 ETH = 10 SOL. */
export const STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR = 10n;
export const STAND_MIN_STAKE_RATE_DATE = "2026-08-30";
export const STAND_MIN_STAKE_RATE_SOURCE = "stand-fixture (1 ETH = 10 SOL)";

const WEI_PER_ETH = 10n ** 18n;
const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Convert ETH-wei weight to lamports at a fixed SOL-per-ETH rate (integer).
 * `solPerEth` is whole SOL per 1 ETH (e.g. 10n for the stand fixture).
 */
export function ethWeiToLamports(wei: bigint, solPerEth: bigint): bigint {
  if (solPerEth <= 0n) {
    throw new Error("ethWeiToLamports: solPerEth must be positive");
  }
  if (wei < 0n) {
    throw new Error("ethWeiToLamports: wei must be non-negative");
  }
  return (wei * solPerEth * LAMPORTS_PER_SOL) / WEI_PER_ETH;
}

/** Stand-pinned min stake lamports from declared 0.05 ETH weight. */
export function standMinStakeLamports(): bigint {
  return ethWeiToLamports(
    DECLARED_MIN_STAKE_NATIVE_WEI,
    STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR,
  );
}

/** Stand-pinned floor lamports from declared 0.001 ETH weight. */
export function standMinStakeFloorLamports(): bigint {
  return ethWeiToLamports(
    DECLARED_MIN_STAKE_FLOOR_WEI,
    STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR,
  );
}

export type MinStakePinRecord = {
  ethWeightWei: string;
  ethFloorWei: string;
  solLamports: string;
  floorLamports: string;
  solPerEth: string;
  rateDate: string;
  source: string;
};

export function standMinStakePinRecord(): MinStakePinRecord {
  return {
    ethWeightWei: DECLARED_MIN_STAKE_NATIVE_WEI.toString(),
    ethFloorWei: DECLARED_MIN_STAKE_FLOOR_WEI.toString(),
    solLamports: standMinStakeLamports().toString(),
    floorLamports: standMinStakeFloorLamports().toString(),
    solPerEth: STAND_MIN_STAKE_ETH_PER_SOL_NUMERATOR.toString(),
    rateDate: STAND_MIN_STAKE_RATE_DATE,
    source: STAND_MIN_STAKE_RATE_SOURCE,
  };
}
