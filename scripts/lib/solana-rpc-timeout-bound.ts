/**
 * Sole owner of the Solana RPC per-class timeout derivation rule.
 *
 *   derived_ms = max(3_000, ceil_to_second(max(10 × p95_ms, 3 × max_ms)))
 *   ceil_to_second(x) = Math.ceil(x / 1000) * 1000
 *
 * Floor reason: one-sitting public-RPC maxima moved 3–5× between measurement
 * runs; a 1 s derived bound would false-refuse users (blockhash_unavailable /
 * simulation_unavailable) under ordinary load.
 */

/** Floor on every derived class bound (see file header). */
export const SVM_RPC_TIMEOUT_FLOOR_MS = 3_000;

/** Bound derivation — sole rule for every measured class. */
export function deriveTimeoutMs(p95Ms: number, maxMs: number): number {
  const raw = Math.ceil(Math.max(10 * p95Ms, 3 * maxMs) / 1000) * 1000;
  return Math.max(SVM_RPC_TIMEOUT_FLOOR_MS, raw);
}
