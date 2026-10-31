/**
 * Measure Solana JSON-RPC latency per call-site class on the owner endpoint.
 * Never prints the RPC URL, host, or any secret.
 *
 *   node --import tsx --env-file=.env.local scripts/measure-solana-rpc-latency.ts
 *
 * Endpoint ownership (no fallback between roles):
 *   ingest classes  → SOLANA_RPC_URL only
 *   product/simulate → NEXT_PUBLIC_SOLANA_RPC_URL only
 *
 * Bound rule (stated once; applied per class):
 *   derived_ms = ceil_to_second(max(10 × p95_ms, 3 × max_ms))
 *   ceil_to_second(x) = Math.ceil(x / 1000) * 1000
 */
import { followedProgramsFromStack } from "../lib/svm/ingest-config.js";
import { postSolanaJsonRpc } from "../lib/svm/solana-json-rpc.js";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.js";
import { requireSvmCommercialActive } from "../lib/web3/commercial-active.js";
import { namespaceFromLayerZeroEid } from "../lib/web3/kargain-namespace.js";
import { solanaGetBlockRequestConfig } from "../svm-ingest/rpc-client.js";

const SAMPLE_N = 100;
const MEASURE_TIMEOUT_MS = 60_000;
const MIN_INTERVAL_MS = 500;
const DEFAULT_EID = 40168;
const SIG_PAGE_LIMIT = 1_000;

/** Bound derivation — sole rule for every measured class. */
export function deriveTimeoutMs(p95Ms: number, maxMs: number): number {
  return Math.ceil(Math.max(10 * p95Ms, 3 * maxMs) / 1000) * 1000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function summarize(samples: number[]): {
  n: number;
  p50: number;
  p95: number;
  max: number;
  derived_ms: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const max = sorted[sorted.length - 1]!;
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95,
    max,
    derived_ms: deriveTimeoutMs(p95, max),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  return /\b429\b/.test(message) || /too many requests/i.test(message);
}

let nextAllowedAt = 0;

async function paced<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const now = Date.now();
  const wait = Math.max(0, nextAllowedAt - now);
  if (wait > 0) await sleep(wait);
  let delay = 500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const t0 = performance.now();
    try {
      const value = await fn();
      const ms = performance.now() - t0;
      nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
      return { ms, value };
    } catch (err) {
      lastErr = err;
      nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
      if (!isRateLimited(err) || attempt === 6) throw err;
      await sleep(delay);
      delay = Math.min(delay * 2, 8_000);
    }
  }
  throw lastErr;
}

function requireIngestRpcUrl(): string {
  const url = process.env.SOLANA_RPC_URL?.trim() ?? "";
  if (!url) {
    console.error("refused: ingest_rpc_absent (SOLANA_RPC_URL)");
    process.exit(1);
  }
  return url;
}

function requireProductRpcUrl(): string {
  const url = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ?? "";
  if (!url) {
    console.error("refused: product_rpc_absent (NEXT_PUBLIC_SOLANA_RPC_URL)");
    process.exit(1);
  }
  return url;
}

async function collectDistinctIngestSlots(
  post: <T>(method: string, params: unknown[]) => Promise<T>,
  programIds: readonly string[],
  need: number,
): Promise<number[]> {
  const slots = new Set<number>();
  for (const programId of programIds) {
    let before: string | undefined;
    while (slots.size < need) {
      const { value: page } = await paced(() =>
        post<Array<{ signature: string; slot: number }>>(
          "getSignaturesForAddress",
          [programId, { before, limit: SIG_PAGE_LIMIT }],
        ),
      );
      if (page.length === 0) break;
      for (const row of page) {
        if (Number.isInteger(row.slot) && row.slot > 0) slots.add(row.slot);
      }
      before = page[page.length - 1]?.signature;
      if (page.length < SIG_PAGE_LIMIT) break;
    }
    if (slots.size >= need) break;
  }
  return [...slots].sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const ingestUrl = requireIngestRpcUrl();
  const productUrl = requireProductRpcUrl();

  console.log(
    `sample_n=${SAMPLE_N} measure_timeout_ms=${MEASURE_TIMEOUT_MS} ` +
      `min_interval_ms=${MIN_INTERVAL_MS} ` +
      `bound_rule=ceil_to_second(max(10*p95,3*max))`,
  );

  const postIngest = <T>(method: string, params: unknown[]) =>
    postSolanaJsonRpc<T>(ingestUrl, method, params, MEASURE_TIMEOUT_MS);
  const postProduct = <T>(method: string, params: unknown[]) =>
    postSolanaJsonRpc<T>(productUrl, method, params, MEASURE_TIMEOUT_MS);

  const namespace = namespaceFromLayerZeroEid(DEFAULT_EID);
  const stack = requireSvmCommercialActive(namespace);
  const programs = followedProgramsFromStack(stack);
  const programIds = programs.map((p) => p.programId);

  type Row = {
    class: string;
    method: string;
    endpoint_role: string;
    samples: number[];
  };
  const rows: Row[] = [];

  // --- ingest: signature pages (followed programs) ---
  {
    const samples: number[] = [];
    let progIdx = 0;
    for (let i = 0; i < SAMPLE_N; i++) {
      const programId = programIds[progIdx % programIds.length]!;
      progIdx += 1;
      const { ms } = await paced(() =>
        postIngest("getSignaturesForAddress", [
          programId,
          { limit: SIG_PAGE_LIMIT },
        ]),
      );
      samples.push(ms);
    }
    rows.push({
      class: "signature_pages",
      method: "getSignaturesForAddress",
      endpoint_role: "ingest_rpc",
      samples,
    });
  }

  // --- ingest: getBlock on distinct discovered slots ---
  {
    // Page followed-program signature history for distinct slots ingest would fetch.
    // If history yields fewer than SAMPLE_N, measure every distinct slot and state n.
    const slots = await collectDistinctIngestSlots(
      postIngest,
      programIds,
      SAMPLE_N,
    );
    const minBlocks = 40;
    if (slots.length < minBlocks) {
      console.error(
        `refused: ingest_block_slots_insufficient have=${slots.length} need_min=${minBlocks}`,
      );
      process.exit(1);
    }
    if (slots.length < SAMPLE_N) {
      console.log(
        `note: ingest_block_n_below_target have=${slots.length} target=${SAMPLE_N} (followed-program signature history exhausted)`,
      );
    }
    const blockN = Math.min(SAMPLE_N, slots.length);
    const samples: number[] = [];
    for (let i = 0; i < blockN; i++) {
      const slot = slots[i]!;
      const { ms } = await paced(() =>
        postIngest("getBlock", [slot, solanaGetBlockRequestConfig()]),
      );
      samples.push(ms);
    }
    rows.push({
      class: "ingest_blocks",
      method: "getBlock",
      endpoint_role: "ingest_rpc",
      samples,
    });
  }

  // --- product reads ---
  const productMethods: Array<{
    method: string;
    params: () => unknown[] | Promise<unknown[]>;
  }> = [
    {
      method: "getLatestBlockhash",
      params: () => [{ commitment: "confirmed" }],
    },
    {
      method: "getBlockHeight",
      params: () => [{ commitment: "confirmed" }],
    },
    {
      method: "getMultipleAccounts",
      params: () => [
        [programIds[0]!],
        { encoding: "base64", commitment: "confirmed" },
      ],
    },
    {
      method: "getAccountInfo",
      params: () => [
        programIds[0]!,
        { encoding: "base64", commitment: "confirmed" },
      ],
    },
    {
      method: "getSignatureStatuses",
      params: async () => {
        const { value: sigs } = await paced(() =>
          postProduct<Array<{ signature: string }>>("getSignaturesForAddress", [
            programIds[0]!,
            { limit: 1 },
          ]),
        );
        const sig = sigs[0]?.signature;
        return [sig ? [sig] : []];
      },
    },
    {
      method: "getTransaction",
      params: async () => {
        const { value: sigs } = await paced(() =>
          postProduct<Array<{ signature: string }>>("getSignaturesForAddress", [
            programIds[0]!,
            { limit: 1 },
          ]),
        );
        const sig = sigs[0]?.signature ?? "";
        return [
          sig,
          {
            commitment: "confirmed",
            encoding: "json",
            maxSupportedTransactionVersion:
              RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
          },
        ];
      },
    },
  ];

  for (const m of productMethods) {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const params = await m.params();
      const { ms } = await paced(() => postProduct(m.method, params));
      samples.push(ms);
    }
    rows.push({
      class: "product_reads",
      method: m.method,
      endpoint_role: "product_rpc",
      samples,
    });
  }

  // --- simulate ---
  {
    const wire =
      "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDArczbBom_Ayl_BkmCLndEgVoJX6O1NTWKehY0xRFOIlcKHwAAAAA";
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const { ms } = await paced(async () => {
        try {
          return await postProduct("simulateTransaction", [
            wire,
            {
              encoding: "base64",
              sigVerify: false,
              replaceRecentBlockhash: true,
              commitment: "confirmed",
            },
          ]);
        } catch (err) {
          if (isRateLimited(err)) throw err;
          return undefined;
        }
      });
      samples.push(ms);
    }
    rows.push({
      class: "simulate",
      method: "simulateTransaction",
      endpoint_role: "product_rpc",
      samples,
    });
  }

  console.log(
    "method\tclass\tendpoint_role\tn\tp50_ms\tp95_ms\tmax_ms\tderived_ms",
  );
  for (const row of rows) {
    const s = summarize(row.samples);
    console.log(
      [
        row.method,
        row.class,
        row.endpoint_role,
        s.n,
        s.p50.toFixed(1),
        s.p95.toFixed(1),
        s.max.toFixed(1),
        s.derived_ms,
      ].join("\t"),
    );
  }
}

main().catch((err) => {
  const name = err instanceof Error ? err.name : "unknown";
  const kind =
    err instanceof Error && /\b429\b/.test(err.message)
      ? "rate_limited"
      : err instanceof Error && /failed/.test(err.message)
        ? "rpc_or_http"
        : "other";
  console.error(`measure_failed name=${name} kind=${kind}`);
  process.exit(1);
});
