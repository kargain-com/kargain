import type { StructuredPayloadDraft } from "@/lib/svm/parse-transaction-ingest";
import { parseTransactionForIngest } from "@/lib/svm/parse-transaction-ingest";
import { followedProgramsFromStack } from "@/lib/svm/ingest-config";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "@/lib/svm/rpc-max-supported-transaction-version";
import { postSolanaJsonRpc } from "@/lib/svm/solana-json-rpc";
import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import {
  createSvmTxConfirmPort,
  type SvmTxConfirmPort,
} from "@/lib/web3/svm-tx-confirm";

type SignatureStatusRow = {
  confirmationStatus?: string | null;
  err?: unknown;
  slot?: number | bigint | null;
} | null;

type GetTransactionResult = {
  slot?: number;
  meta?: {
    err?: unknown;
    logMessages?: string[] | null;
  } | null;
} | null;

/**
 * Browser/public Solana RPC for product writes and confirms.
 * Fail closed when unset — no silent public Devnet invent in the owner.
 */
export function productSvmRpcUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function productSvmRpcUrlRefusalCopy(): string {
  return "Solana RPC is not configured for this network.";
}

/**
 * JSON-RPC confirm port at owner commitment.
 * Uses plain fetch to stay outside wallet-adapter and Solana SDK graph rules.
 */
export function createProductSvmTxConfirmPort(): SvmTxConfirmPort {
  const rpcUrl = productSvmRpcUrl();
  if (!rpcUrl) {
    throw new Error(productSvmRpcUrlRefusalCopy());
  }
  return createSvmTxConfirmPort({
    getSignatureStatuses: async (signatures: string[]) => {
      const result = await postSolanaJsonRpc<{ value: SignatureStatusRow[] }>(
        rpcUrl,
        "getSignatureStatuses",
        [signatures],
      );
      return result.value;
    },
  });
}

/**
 * Fetch and parse D-28 structured payloads for one confirmed SVM transaction.
 * This reuses the ingest parser instead of inventing a second program-log decoder.
 */
export async function fetchSvmTransactionStructuredPayloads(args: {
  stack: SvmCommercialActiveStack;
  signature: string;
  slotHint?: bigint;
}): Promise<StructuredPayloadDraft[]> {
  const rpcUrl = productSvmRpcUrl();
  if (!rpcUrl) {
    throw new Error(productSvmRpcUrlRefusalCopy());
  }
  const tx = await postSolanaJsonRpc<GetTransactionResult>(rpcUrl, "getTransaction", [
    args.signature,
    {
      commitment: "confirmed",
      encoding: "json",
      maxSupportedTransactionVersion: RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
    },
  ]);
  if (!tx) {
    throw new Error("Solana transaction could not be loaded after confirmation.");
  }
  const slot =
    typeof tx.slot === "number"
      ? tx.slot
      : typeof args.slotHint === "bigint"
        ? Number(args.slotHint)
        : 0;
  const parsed = parseTransactionForIngest({
    namespace: Number(args.stack.namespace),
    slot,
    txIndexInBlock: 0,
    txSignature: args.signature,
    logMessages: tx.meta?.logMessages,
    metaErr: tx.meta?.err ?? null,
    followedPrograms: followedProgramsFromStack(args.stack),
  });
  return parsed.payloads;
}
