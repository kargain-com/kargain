/**
 * Sole owner of the ADR 0014 §e rollback-model decision (pure).
 * Window rule (R10): every EXPECTED chain needs ≥3 samples spanning ≥30 minutes; a
 * missing chain and an extra chain are both refusals. The expected chain set comes from
 * the ponder-env owner (ponderStatusChainNameById) — the CLI binds it, this module never
 * invents one. Imports only types from ./ponder-deploy-state.js.
 */
import type { PonderRollbackModel } from "./ponder-deploy-state.js";

export type LagSample = {
  chainId: number;
  lag_seconds: number;
  at: string;
  sampleAt?: string;
};

export const MIN_SAMPLES_PER_CHAIN = 3;
export const MIN_SPAN_MS = 30 * 60 * 1000;

export function validateSamples(
  label: string,
  rows: readonly LagSample[],
  expectedChainIds: readonly number[],
): void {
  if (expectedChainIds.length === 0) {
    throw new Error(
      `decide_rollback_model_refused: ${label} expected chain set is empty`,
    );
  }
  for (const r of rows) {
    if (
      typeof r.lag_seconds !== "number" ||
      !Number.isFinite(r.lag_seconds) ||
      r.lag_seconds < 0
    ) {
      throw new Error(
        `decide_rollback_model_refused: ${label} non-finite or negative lag_seconds`,
      );
    }
  }
  if (rows.length === 0) {
    throw new Error(`decide_rollback_model_refused: ${label} empty`);
  }
  const expected = new Set(expectedChainIds);
  for (const chainId of new Set(rows.map((r) => r.chainId))) {
    if (!expected.has(chainId)) {
      throw new Error(
        `decide_rollback_model_refused: ${label} extra chain ${chainId}`,
      );
    }
  }
  for (const chainId of expectedChainIds) {
    const forChain = rows.filter((r) => r.chainId === chainId);
    if (forChain.length === 0) {
      throw new Error(
        `decide_rollback_model_refused: ${label} missing chain ${chainId}`,
      );
    }
    if (forChain.length < MIN_SAMPLES_PER_CHAIN) {
      throw new Error(
        `decide_rollback_model_refused: ${label} needs ≥${MIN_SAMPLES_PER_CHAIN} samples for chain ${chainId}, got ${forChain.length}`,
      );
    }
    const times = forChain.map((r) => Date.parse(r.at || r.sampleAt || ""));
    if (times.some((t) => Number.isNaN(t))) {
      throw new Error(
        `decide_rollback_model_refused: ${label} sample missing valid at timestamp`,
      );
    }
    const spanMs = Math.max(...times) - Math.min(...times);
    if (spanMs < MIN_SPAN_MS) {
      throw new Error(
        `decide_rollback_model_refused: ${label} chain ${chainId} span ${spanMs}ms < 30m`,
      );
    }
  }
}

export function decideRollbackModel(
  baseline: readonly LagSample[],
  dual: readonly LagSample[],
  expectedChainIds: readonly number[],
): {
  l_single_max: number;
  m: number;
  b: number;
  rollback_model: PonderRollbackModel;
} {
  validateSamples("baseline", baseline, expectedChainIds);
  validateSamples("dual", dual, expectedChainIds);

  const l_single_max = Math.max(...baseline.map((r) => r.lag_seconds));
  const m = Math.max(l_single_max, 30);
  const b = l_single_max + m;

  const pass = dual.every((r) => r.lag_seconds <= b);
  return {
    l_single_max,
    m,
    b,
    rollback_model: pass ? "keep_previous" : "restart_previous",
  };
}
