import type { StructuredPayloadDraft } from "@/lib/svm/parse-transaction-ingest";
import { parseTransactionForIngest } from "@/lib/svm/parse-transaction-ingest";
import type { FollowedProgram } from "@/lib/svm/ingest-config";
import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import {
  createSvmTxConfirmPort,
  type SvmTxConfirmPort,
} from "@/lib/web3/svm-tx-confirm";

type JsonRpcSuccess<T> = { jsonrpc: "2.0"; id: number; result: T };
type JsonRpcFailure = {
  jsonrpc: "2.0";
  id: number;
  error: { code: number; message: string };
};

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

function followedProgramsFromStack(
  stack: SvmCommercialActiveStack,
): FollowedProgram[] {
  const out: FollowedProgram[] = [
    {
      slug: "kar-passport",
      programId: stack.karPassport,
      evidenceKey: "kar_passport",
    },
    {
      slug: "kar-pro-staking",
      programId: stack.karProStaking,
      evidenceKey: "kar_pro_staking",
    },
    {
      slug: "kar-pro-pass",
      programId: stack.karProPass,
      evidenceKey: "kar_pro_pass",
    },
    {
      slug: "kar-gateway",
      programId: stack.bridgeGateway,
      evidenceKey: "kar_gateway",
    },
  ];
  if (stack.fixedPriceConsignment) {
    out.push({
      slug: "kar-fixed-price",
      programId: stack.fixedPriceConsignment,
      evidenceKey: "kar_fixed_price",
    });
  }
  if (stack.ascendingConsignment) {
    out.push({
      slug: "kar-ascending",
      programId: stack.ascendingConsignment,
      evidenceKey: "kar_ascending",
    });
  }
  return out;
}

async function postJsonRpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!response.ok) {
    throw new Error(`Solana RPC request failed: ${response.status}`);
  }
  const body = (await response.json()) as JsonRpcSuccess<T> | JsonRpcFailure;
  if ("error" in body) {
    throw new Error(`Solana RPC ${method} failed: ${body.error.message}`);
  }
  return body.result;
}

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
      const result = await postJsonRpc<{ value: SignatureStatusRow[] }>(
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
  const tx = await postJsonRpc<GetTransactionResult>(rpcUrl, "getTransaction", [
    args.signature,
    {
      commitment: "confirmed",
      encoding: "json",
      maxSupportedTransactionVersion: 0,
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
