/**
 * Sole classifier for svm-ingest RPC failures → catch-up incidents.
 * Call sites pass phase/slot as detail data only — never copy the mapping.
 */
import { isSolanaRpcUnreachableError } from "../lib/svm/solana-json-rpc.js";
import type { CatchupIncident } from "../lib/svm/ingest-refusal.js";
import { SvmIngestRpcBudgetExhaustedError } from "./rpc-client.js";

export type IngestRpcFailureClass =
  | {
      kind: "incident";
      incident: Extract<
        CatchupIncident,
        "rpc_budget_exhausted" | "rpc_unreachable"
      >;
      detail: Record<string, unknown>;
    }
  | { kind: "other"; err: unknown };

/**
 * Map a thrown RPC error to a named retriable incident, or leave it as other.
 */
export function classifyIngestRpcFailure(
  err: unknown,
  extraDetail: Record<string, unknown> = {},
): IngestRpcFailureClass {
  if (err instanceof SvmIngestRpcBudgetExhaustedError) {
    return {
      kind: "incident",
      incident: "rpc_budget_exhausted",
      detail: { message: err.message, ...extraDetail },
    };
  }
  if (isSolanaRpcUnreachableError(err)) {
    return {
      kind: "incident",
      incident: "rpc_unreachable",
      detail: {
        name: err instanceof Error ? err.name : "unreachable",
        ...extraDetail,
      },
    };
  }
  return { kind: "other", err };
}
