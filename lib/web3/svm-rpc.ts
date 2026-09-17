import type { StructuredPayloadDraft } from "@/lib/svm/parse-transaction-ingest";
import { parseTransactionForIngest } from "@/lib/svm/parse-transaction-ingest";
import { followedProgramsFromStack } from "@/lib/svm/ingest-config";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "@/lib/svm/rpc-max-supported-transaction-version";
import { postSolanaJsonRpc } from "@/lib/svm/solana-json-rpc";
import type { SvmCommercialActiveStack } from "@/lib/web3/commercial-active";
import type { SvmKeyedAccountSource } from "@/lib/web3/svm-keyed-read";
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

type GetLatestBlockhashRpcValue = {
  blockhash?: string;
  lastValidBlockHeight?: number | string;
} | null;

type GetAccountInfoRpcValue = {
  data?: [string, string] | string;
  executable?: boolean;
  lamports?: number;
  owner?: string;
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

export type SvmLatestBlockhash = {
  blockhash: string;
  lastValidBlockHeight: bigint;
};

export type FetchSvmLatestBlockhashCause =
  | "blockhash_unavailable"
  | "blockhash_expired";

export type FetchSvmLatestBlockhashResult =
  | { ok: true; value: SvmLatestBlockhash }
  | {
      ok: false;
      cause: FetchSvmLatestBlockhashCause;
      detail: string;
    };

/**
 * Latest blockhash for product SVM writes — same transport as confirm/getTransaction.
 * No retry loop; missing/malformed/expired are named refusals.
 */
export async function fetchProductSvmLatestBlockhash(opts?: {
  /** Injected tip height for expiry checks (tests). Default: `getBlockHeight`. */
  fetchBlockHeight?: (rpcUrl: string) => Promise<bigint>;
}): Promise<FetchSvmLatestBlockhashResult> {
  const rpcUrl = productSvmRpcUrl();
  if (!rpcUrl) {
    return {
      ok: false,
      cause: "blockhash_unavailable",
      detail: productSvmRpcUrlRefusalCopy(),
    };
  }
  let value: GetLatestBlockhashRpcValue;
  try {
    const result = await postSolanaJsonRpc<{ value: GetLatestBlockhashRpcValue }>(
      rpcUrl,
      "getLatestBlockhash",
      [{ commitment: "confirmed" }],
    );
    value = result.value;
  } catch (err) {
    return {
      ok: false,
      cause: "blockhash_unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  const blockhash =
    typeof value?.blockhash === "string" ? value.blockhash.trim() : "";
  if (blockhash.length === 0) {
    return {
      ok: false,
      cause: "blockhash_unavailable",
      detail: "getLatestBlockhash returned no blockhash",
    };
  }
  let lastValidBlockHeight: bigint;
  try {
    lastValidBlockHeight = BigInt(value?.lastValidBlockHeight ?? "");
  } catch {
    return {
      ok: false,
      cause: "blockhash_unavailable",
      detail: "getLatestBlockhash returned no lastValidBlockHeight",
    };
  }

  const fetchHeight =
    opts?.fetchBlockHeight ??
    (async (url: string) => {
      const height = await postSolanaJsonRpc<number | string>(url, "getBlockHeight", [
        { commitment: "confirmed" },
      ]);
      return BigInt(height);
    });

  let tip: bigint;
  try {
    tip = await fetchHeight(rpcUrl);
  } catch (err) {
    return {
      ok: false,
      cause: "blockhash_unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (tip > lastValidBlockHeight) {
    return {
      ok: false,
      cause: "blockhash_expired",
      detail: `tip ${tip} > lastValidBlockHeight ${lastValidBlockHeight}`,
    };
  }

  return {
    ok: true,
    value: { blockhash, lastValidBlockHeight },
  };
}

export type FetchSvmAccountDataCause =
  | "rpc_unavailable"
  | "account_not_found"
  | "malformed_response";

export type FetchSvmAccountDataResult =
  | { ok: true; value: Uint8Array }
  | {
      ok: false;
      cause: FetchSvmAccountDataCause;
      detail: string;
    };

/** Per-account result from {@link fetchProductSvmAccountsData} (order matches input). */
export type FetchSvmAccountsDataResult =
  | { ok: true; values: FetchSvmAccountDataResult[] }
  | {
      ok: false;
      cause: "rpc_unavailable";
      detail: string;
    };

function decodeAccountInfoValue(
  value: GetAccountInfoRpcValue,
  accountLabel: string,
): FetchSvmAccountDataResult {
  if (value == null) {
    return {
      ok: false,
      cause: "account_not_found",
      detail: `account read returned null for ${accountLabel}`,
    };
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length < 2) {
    return {
      ok: false,
      cause: "malformed_response",
      detail: "account data is not a base64 tuple",
    };
  }
  const [b64, encoding] = data;
  if (encoding !== "base64" || typeof b64 !== "string") {
    return {
      ok: false,
      cause: "malformed_response",
      detail: `account unexpected encoding: ${String(encoding)}`,
    };
  }
  try {
    const binary =
      typeof atob === "function"
        ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        : Uint8Array.from(Buffer.from(b64, "base64"));
    return { ok: true, value: binary };
  } catch (err) {
    return {
      ok: false,
      cause: "malformed_response",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch account data for product SVM keyed reads — one `getMultipleAccounts`.
 * Absent accounts are named per slot (`account_not_found`); never empty buffers.
 * Deduplicates the wire list; results are remapped to the caller's order.
 */
export async function fetchProductSvmAccountsData(
  accounts: readonly string[],
): Promise<FetchSvmAccountsDataResult> {
  const rpcUrl = productSvmRpcUrl();
  if (!rpcUrl) {
    return {
      ok: false,
      cause: "rpc_unavailable",
      detail: productSvmRpcUrlRefusalCopy(),
    };
  }
  if (accounts.length === 0) {
    return { ok: true, values: [] };
  }

  const unique: string[] = [];
  const firstIndex = new Map<string, number>();
  for (const account of accounts) {
    if (!firstIndex.has(account)) {
      firstIndex.set(account, unique.length);
      unique.push(account);
    }
  }

  let wireValues: GetAccountInfoRpcValue[];
  try {
    const result = await postSolanaJsonRpc<{
      value: GetAccountInfoRpcValue[];
    }>(rpcUrl, "getMultipleAccounts", [
      unique,
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (!Array.isArray(result.value) || result.value.length !== unique.length) {
      return {
        ok: false,
        cause: "rpc_unavailable",
        detail: "getMultipleAccounts returned malformed value array",
      };
    }
    wireValues = result.value;
  } catch (err) {
    return {
      ok: false,
      cause: "rpc_unavailable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const decodedUnique = unique.map((account, i) =>
    decodeAccountInfoValue(wireValues[i] ?? null, account),
  );
  return {
    ok: true,
    values: accounts.map((account) => {
      const idx = firstIndex.get(account);
      return idx == null
        ? {
            ok: false as const,
            cause: "malformed_response" as const,
            detail: `missing unique index for ${account}`,
          }
        : decodedUnique[idx]!;
    }),
  };
}

/**
 * Single-account convenience — same decode path as the batch door (length-1).
 * Write-path freshness (AppendRecord etc.) uses this; keyed batches use the multi door.
 */
export async function fetchProductSvmAccountData(
  account: string,
): Promise<FetchSvmAccountDataResult> {
  const batch = await fetchProductSvmAccountsData([account]);
  if (!batch.ok) {
    return { ok: false, cause: batch.cause, detail: batch.detail };
  }
  return (
    batch.values[0] ?? {
      ok: false,
      cause: "malformed_response",
      detail: "empty batch result for single account",
    }
  );
}

/**
 * Product {@link SvmKeyedAccountSource}: one `getMultipleAccounts` per batch.
 * Not-found → null slot (keyed-read names the miss). Other refusals throw by cause name.
 */
export function createProductSvmKeyedAccountSource(): SvmKeyedAccountSource {
  return {
    getAccountsData: async (accounts: readonly string[]) => {
      const batch = await fetchProductSvmAccountsData(accounts);
      if (!batch.ok) {
        throw new Error(`${batch.cause}: ${batch.detail}`);
      }
      return batch.values.map((result) => {
        if (result.ok) return result.value;
        if (result.cause === "account_not_found") return null;
        throw new Error(`${result.cause}: ${result.detail}`);
      });
    },
  };
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
