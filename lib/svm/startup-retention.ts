/**
 * Sole predicate: does the configured RPC retain the required ingest start slot?
 * Consumed by svm-ingest startup and by upgrade-in-place --dry-run.
 * Incident name matches CatchupIncident — do not invent a parallel vocabulary.
 */

export const STARTUP_RETENTION_UNAVAILABLE = "startup_retention_unavailable" as const;

export type StartupRetentionDetail = {
  reason: "required_slot_before_first_available_block";
  requiredSlot: number;
  firstAvailableBlock: number;
  headSlot: number;
};

export type StartupRetentionResult =
  | { ok: true }
  | {
      ok: false;
      incident: typeof STARTUP_RETENTION_UNAVAILABLE;
      detail: StartupRetentionDetail;
    };

/**
 * Same rule as historical ingest assertStartupRetention:
 * if the required floor is at or before tip, the RPC must still serve it
 * (requiredSlot >= firstAvailableBlock). A future required slot is always ok.
 */
export function evaluateStartupRetention(args: {
  requiredSlot: number;
  firstAvailableBlock: number;
  headSlot: number;
}): StartupRetentionResult {
  const { requiredSlot, firstAvailableBlock, headSlot } = args;
  if (requiredSlot > headSlot) return { ok: true };
  if (requiredSlot >= firstAvailableBlock) return { ok: true };
  return {
    ok: false,
    incident: STARTUP_RETENTION_UNAVAILABLE,
    detail: {
      reason: "required_slot_before_first_available_block",
      requiredSlot,
      firstAvailableBlock,
      headSlot,
    },
  };
}

export function startupRetentionUnavailableMessage(
  detail: StartupRetentionDetail,
): string {
  return (
    `svm-ingest RPC retention unavailable: required slot ${detail.requiredSlot} ` +
    `is before first available block ${detail.firstAvailableBlock}`
  );
}
