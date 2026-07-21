/**
 * Hub→spoke SEND_AND_COMPOSE lzReceive gas policy.
 *
 * Pathway `enforcedOptions` pin type2 gas at {@link ENFORCED_GAS_SEND_AND_COMPOSE}
 * (floor for typical Irys/`ar://` URIs). Sender may raise Executor lzReceive gas
 * via `extraOptions` when the compose URI is longer — see Hardhat dest gas table
 * in `test/bridge-onft.test.ts` (endpoint-impersonated lzReceive):
 *
 * | Path | gasUsed (anchor) |
 * |------|------------------|
 * | typical `ar://…` | {@link LZ_RECEIVE_MEASURED_TYPICAL_GAS} |
 * | 500-char URI | {@link LZ_RECEIVE_MEASURED_500_CHAR_GAS} |
 * | spoke→hub SEND | ~64249 → type1 floor {@link ENFORCED_GAS_SEND} |
 *
 * Linear model (before margin): `BASE + byteLen * PER_BYTE`, then margin BPS,
 * then `max(floor, …)`. Over {@link LZ_RECEIVE_GAS_CAP}: fail closed (refuse
 * quote/send) — do not clamp and risk OOG lock in the adapter.
 */

/** Pathway floor — ONFT SEND (return / non-compose). */
export const ENFORCED_GAS_SEND = 100_000;

/** Pathway floor — ONFT SEND_AND_COMPOSE (hub→spoke with URI). Policy floor. */
export const ENFORCED_GAS_SEND_AND_COMPOSE = 250_000;

/** Hardhat dest gas for typical Arweave URI (~48 bytes). */
export const LZ_RECEIVE_MEASURED_TYPICAL_GAS = 184_973;

/** Hardhat dest gas for 500-char URI. */
export const LZ_RECEIVE_MEASURED_500_CHAR_GAS = 621_678;

/**
 * Intercept so `BASE + typicalLen * PER_BYTE ≈` measured typical before margin
 * (typicalLen ≈ 48 → 137_973 + 48_000 = 185_973, near 184_973).
 */
export const LZ_RECEIVE_GAS_BASE = 137_973;

/** Rounded up from measured slope ~(621678−184973)/(500−48) ≈ 966. */
export const LZ_RECEIVE_GAS_PER_URI_BYTE = 1_000;

/** 15% margin on the linear model. */
export const LZ_RECEIVE_GAS_MARGIN_BPS = 1_500;

/** Fail-closed ceiling (aligned with Hardhat suite lzReceive budget). */
export const LZ_RECEIVE_GAS_CAP = 1_000_000;

export type LzReceiveGasOk = { ok: true; gas: number };
export type LzReceiveGasCapExceeded = {
  ok: false;
  reason: "exceeds_cap";
  required: number;
  cap: number;
};
export type LzReceiveGasResult = LzReceiveGasOk | LzReceiveGasCapExceeded;

function utf8ByteLength(uri: string): number {
  return new TextEncoder().encode(uri).byteLength;
}

/**
 * Required Executor lzReceive gas for hub→spoke compose given URI byte length.
 * Fail closed when the margined model exceeds {@link LZ_RECEIVE_GAS_CAP}.
 */
export function requiredLzReceiveGasForByteLength(
  byteLength: number,
): LzReceiveGasResult {
  const len = Math.max(0, Math.floor(byteLength));
  const modeled = LZ_RECEIVE_GAS_BASE + len * LZ_RECEIVE_GAS_PER_URI_BYTE;
  const margined = Math.ceil(
    (modeled * (10_000 + LZ_RECEIVE_GAS_MARGIN_BPS)) / 10_000,
  );
  const required = Math.max(ENFORCED_GAS_SEND_AND_COMPOSE, margined);
  if (required > LZ_RECEIVE_GAS_CAP) {
    return {
      ok: false,
      reason: "exceeds_cap",
      required,
      cap: LZ_RECEIVE_GAS_CAP,
    };
  }
  return { ok: true, gas: required };
}

/** Same as {@link requiredLzReceiveGasForByteLength} using UTF-8 byte length of `uri`. */
export function requiredLzReceiveGasForUri(uri: string): LzReceiveGasResult {
  return requiredLzReceiveGasForByteLength(utf8ByteLength(uri));
}
