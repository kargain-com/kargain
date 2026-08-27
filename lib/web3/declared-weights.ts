/**
 * Declared protocol weight in wei for generation-v2 EVM (SPEC §13.10).
 *
 * Anchor is ETH-denominated weight in the SPEC; these are the wei forms used by
 * deploy/local tooling. Sole owner of these literals — consumers import.
 */

/** `minStakeNative` — 0.05 ETH. */
export const DECLARED_MIN_STAKE_NATIVE_WEI = 50_000_000_000_000_000n;

/** `MIN_STAKE_FLOOR` model constant — 0.001 ETH. */
export const DECLARED_MIN_STAKE_FLOOR_WEI = 1_000_000_000_000_000n;

/** Verification `disputeDeposit` — 0.01 ETH. */
export const DECLARED_DISPUTE_DEPOSIT_WEI = 10_000_000_000_000_000n;

/** Ascending settlement `challengeBond` — same weight as dispute deposit. */
export const DECLARED_ASCENDING_CHALLENGE_BOND_WEI = DECLARED_DISPUTE_DEPOSIT_WEI;
