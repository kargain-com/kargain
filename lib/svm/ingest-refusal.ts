/**
 * S7c-1 ingest refusal vocabulary — not Truth-layer T# or Ponder freshness classes.
 */

export const INGEST_REFUSAL_KINDS = [
  "log_truncated",
  "unknown_discriminator",
  "payload_malformed",
  "sequence_gap",
] as const;

export type IngestRefusalKind = (typeof INGEST_REFUSAL_KINDS)[number];

export const BOOTSTRAP_CATCHUP_STATES = ["historical_backfill"] as const;
export type BootstrapCatchupState = (typeof BOOTSTRAP_CATCHUP_STATES)[number];

export type CatchupIncident =
  | "catchup_window_exceeded"
  | "sequence_gap"
  | "startup_retention_unavailable"
  | "discovery_incomplete"
  | "rpc_budget_exhausted";

export function structuredPayloadRowId(args: {
  namespace: number;
  slot: number;
  txIndexInBlock: number;
  logIndex: number;
}): string {
  return `${args.namespace}:${args.slot}:${args.txIndexInBlock}:${args.logIndex}`;
}

export function ingestRefusalRowId(args: {
  namespace: number;
  refusalKind: IngestRefusalKind;
  slot: number | null;
  txSignature: string | null;
  logIndex: number | null;
  detailKey: string;
}): string {
  const slotPart = args.slot ?? "none";
  const sigPart = args.txSignature ?? "none";
  const logPart = args.logIndex ?? "none";
  return `${args.namespace}:${args.refusalKind}:${slotPart}:${sigPart}:${logPart}:${args.detailKey}`;
}
