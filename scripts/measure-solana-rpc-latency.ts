/**
 * Measure Solana JSON-RPC latency classes on the configured RPC (by role).
 * Never prints the RPC URL, host, or any secret.
 *
 *   node --import tsx --env-file=.env.local scripts/measure-solana-rpc-latency.ts
 *
 * Env (first present wins): SOLANA_RPC_URL, then NEXT_PUBLIC_SOLANA_RPC_URL.
 * Paces at ~2 rps and backs off on 429 so measurement does not starve itself.
 */
import { solanaGetBlockRequestConfig } from "../svm-ingest/rpc-client.js";
import { postSolanaJsonRpc } from "../lib/svm/solana-json-rpc.js";
import { RPC_MAX_SUPPORTED_TRANSACTION_VERSION } from "../lib/svm/rpc-max-supported-transaction-version.js";

const SAMPLE_N = 21;
const MEASURE_TIMEOUT_MS = 60_000;
const MIN_INTERVAL_MS = 500;

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
} {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
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

async function main(): Promise<void> {
  const rpcUrl =
    process.env.SOLANA_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    "";
  if (!rpcUrl) {
    console.error(
      "refused: configured_rpc_absent (set SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL)",
    );
    process.exit(1);
  }
  console.log(
    "endpoint_role=configured_devnet_rpc sample_n=" +
      SAMPLE_N +
      " measure_timeout_ms=" +
      MEASURE_TIMEOUT_MS +
      " min_interval_ms=" +
      MIN_INTERVAL_MS,
  );

  const post = <T>(method: string, params: unknown[]) =>
    postSolanaJsonRpc<T>(rpcUrl, method, params, MEASURE_TIMEOUT_MS);

  const tip = (
    await paced(() => post<number>("getSlot", [{ commitment: "confirmed" }]))
  ).value;
  const systemProgram = "11111111111111111111111111111111";

  type Row = { class: string; method: string; samples: number[] };
  const rows: Row[] = [];

  {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const trySlot = Math.max(0, tip - (i % 8) - 1);
      const { ms } = await paced(() =>
        post<unknown>("getBlock", [trySlot, solanaGetBlockRequestConfig()]),
      );
      samples.push(ms);
    }
    rows.push({ class: "ingest_blocks", method: "getBlock", samples });
  }

  {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const { ms } = await paced(() =>
        post<unknown[]>("getSignaturesForAddress", [
          systemProgram,
          { limit: 1_000 },
        ]),
      );
      samples.push(ms);
    }
    rows.push({
      class: "signature_pages",
      method: "getSignaturesForAddress",
      samples,
    });
  }

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
        [systemProgram],
        { encoding: "base64", commitment: "confirmed" },
      ],
    },
    {
      method: "getAccountInfo",
      params: () => [
        systemProgram,
        { encoding: "base64", commitment: "confirmed" },
      ],
    },
    {
      method: "getSignatureStatuses",
      params: async () => {
        const { value: sigs } = await paced(() =>
          post<Array<{ signature: string }>>("getSignaturesForAddress", [
            systemProgram,
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
          post<Array<{ signature: string }>>("getSignaturesForAddress", [
            systemProgram,
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
      const { ms } = await paced(() => post(m.method, params));
      samples.push(ms);
    }
    rows.push({ class: "product_reads", method: m.method, samples });
  }

  {
    const wire =
      "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDArczbBom_Ayl_BkmCLndEgVoJX6O1NTWKehY0xRFOIlcKHwAAAAA";
    const samples: number[] = [];
    for (let i = 0; i < SAMPLE_N; i++) {
      const { ms } = await paced(async () => {
        try {
          return await post("simulateTransaction", [
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
          // Answered JSON-RPC error still counts as a round-trip sample.
          return undefined;
        }
      });
      samples.push(ms);
    }
    rows.push({
      class: "simulate",
      method: "simulateTransaction",
      samples,
    });
  }

  console.log("method\tclass\tn\tp50_ms\tp95_ms\tmax_ms");
  for (const row of rows) {
    const s = summarize(row.samples);
    console.log(
      [
        row.method,
        row.class,
        s.n,
        s.p50.toFixed(1),
        s.p95.toFixed(1),
        s.max.toFixed(1),
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
