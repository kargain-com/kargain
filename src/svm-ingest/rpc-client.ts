/**
 * Solana RPC fetch surface for svm-ingest (injectable for tests).
 * Budgeted requests; missing blocks are named results, never process-killing throws.
 * getBlock uses JSON-RPC + lib/svm wire mapper — never Connection.getBlock (web3.js rejects v1).
 */

import { Connection, PublicKey } from "@solana/web3.js";

import { resolveIngestMaxRps } from "../../lib/svm/ingest-config.js";
import { mapGetBlockResultToFetchedTransactions } from "../../lib/svm/rpc-block-transactions.js";
import type { GetBlockWireResult } from "../../lib/svm/rpc-block-transactions.js";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../../lib/svm/rpc-max-supported-transaction-version.js";
import {
  postSolanaJsonRpc,
  type SolanaJsonRpcPost,
} from "../../lib/svm/solana-json-rpc.js";

export type FetchedBlock = {
  slot: number;
  transactions: FetchedBlockTransaction[];
};

export type FetchedBlockTransaction = {
  signature: string;
  metaErr: unknown;
  logMessages: string[] | null;
};

export type SignatureInfo = {
  signature: string;
  slot: number;
};

export type GetBlockOutcome =
  | { status: "ok"; block: FetchedBlock }
  | { status: "missing_block"; slot: number };

export type SvmRpcCallCounts = {
  getBlock: number;
  getSignaturesForAddress: number;
  getSlot: number;
  getFirstAvailableBlock: number;
};

export type SvmRpcClient = {
  getSlot: () => Promise<number>;
  getFirstAvailableBlock: () => Promise<number>;
  getBlock: (slot: number) => Promise<GetBlockOutcome>;
  getSignaturesForAddress: (
    programId: string,
    opts?: { before?: string; limit?: number },
  ) => Promise<SignatureInfo[]>;
  /** Test / measurement counters. */
  callCounts: SvmRpcCallCounts;
};

const DEFAULT_429_MAX_ATTEMPTS = 6;
const DEFAULT_MISSING_BLOCK_RETRIES = 2;

function isMissingBlockError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (/skipped, or missing in long-term storage/i.test(message)) return true;
  if (/Slot \d+ was skipped/i.test(message)) return true;
  const code =
    err && typeof err === "object" && "code" in err
      ? Number((err as { code: unknown }).code)
      : NaN;
  return code === -32009;
}

function isRateLimitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (/\b429\b/.test(message)) return true;
  if (/too many requests/i.test(message)) return true;
  return false;
}

export class SvmIngestRpcBudgetExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvmIngestRpcBudgetExhaustedError";
  }
}

function createRateLimiter(maxRps: number): {
  schedule: <T>(fn: () => Promise<T>) => Promise<T>;
} {
  const minIntervalMs = 1000 / maxRps;
  let nextAllowedAt = 0;
  return {
    async schedule<T>(fn: () => Promise<T>): Promise<T> {
      const now = Date.now();
      const wait = Math.max(0, nextAllowedAt - now);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      nextAllowedAt = Date.now() + minIntervalMs;
      return fn();
    },
  };
}

/** Exported for planted 429 control tests; production path uses this only via createSolanaRpcClient. */
export async function with429Backoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = DEFAULT_429_MAX_ATTEMPTS,
): Promise<T> {
  let delayMs = 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRateLimitError(err) || attempt === maxAttempts) {
        if (isRateLimitError(err)) {
          throw new SvmIngestRpcBudgetExhaustedError(
            `Solana RPC rate limit exhausted after ${maxAttempts} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 8_000);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr));
}

export type CreateSolanaRpcClientOptions = {
  maxRps?: number;
  missingBlockRetries?: number;
  rateLimitMaxAttempts?: number;
  /** Test-only Connection inject — production omits this. */
  connection?: Connection;
  /** Test-only JSON-RPC inject for getBlock — production uses postSolanaJsonRpc. */
  jsonRpcPost?: SolanaJsonRpcPost;
};

export function solanaGetBlockRequestConfig(): {
  encoding: "json";
  transactionDetails: "full";
  rewards: false;
  commitment: "confirmed";
  maxSupportedTransactionVersion: typeof RPC_MAX_SUPPORTED_TRANSACTION_VERSION;
} {
  return {
    encoding: "json",
    transactionDetails: "full",
    rewards: false,
    commitment: "confirmed",
    maxSupportedTransactionVersion: RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
  };
}

export function createSolanaRpcClient(
  rpcUrl: string,
  options?: CreateSolanaRpcClientOptions,
): SvmRpcClient {
  const connection =
    options?.connection ??
    new Connection(rpcUrl, {
      commitment: "confirmed",
      // Sole 429 owner is with429Backoff below — never dual-retry with web3.js.
      disableRetryOnRateLimit: true,
    });
  const jsonRpcPost = options?.jsonRpcPost ?? postSolanaJsonRpc;
  const maxRps = options?.maxRps ?? resolveIngestMaxRps();
  const limiter = createRateLimiter(maxRps);
  const missingBlockRetries =
    options?.missingBlockRetries ?? DEFAULT_MISSING_BLOCK_RETRIES;
  const rateLimitMaxAttempts =
    options?.rateLimitMaxAttempts ?? DEFAULT_429_MAX_ATTEMPTS;
  const callCounts: SvmRpcCallCounts = {
    getBlock: 0,
    getSignaturesForAddress: 0,
    getSlot: 0,
    getFirstAvailableBlock: 0,
  };

  async function budgeted<T>(fn: () => Promise<T>): Promise<T> {
    return limiter.schedule(() => with429Backoff(fn, rateLimitMaxAttempts));
  }

  return {
    callCounts,
    async getSlot() {
      callCounts.getSlot += 1;
      return budgeted(() => connection.getSlot("confirmed"));
    },
    async getFirstAvailableBlock() {
      callCounts.getFirstAvailableBlock += 1;
      return budgeted(() => connection.getFirstAvailableBlock());
    },
    async getSignaturesForAddress(programId, opts) {
      callCounts.getSignaturesForAddress += 1;
      const limit = opts?.limit ?? 1_000;
      const rows = await budgeted(() =>
        connection.getSignaturesForAddress(new PublicKey(programId), {
          before: opts?.before,
          limit,
        }),
      );
      return rows.map((r) => ({
        signature: r.signature,
        slot: r.slot,
      }));
    },
    async getBlock(slot) {
      for (let attempt = 0; attempt <= missingBlockRetries; attempt++) {
        callCounts.getBlock += 1;
        try {
          const result = await budgeted(() =>
            jsonRpcPost<GetBlockWireResult>(rpcUrl, "getBlock", [
              slot,
              solanaGetBlockRequestConfig(),
            ]),
          );
          if (result == null) {
            if (attempt < missingBlockRetries) continue;
            return { status: "missing_block", slot };
          }
          const txs = mapGetBlockResultToFetchedTransactions(result, slot);
          return { status: "ok", block: { slot, transactions: txs } };
        } catch (err) {
          if (isMissingBlockError(err)) {
            if (attempt < missingBlockRetries) continue;
            return { status: "missing_block", slot };
          }
          throw err;
        }
      }
      return { status: "missing_block", slot };
    },
  };
}
