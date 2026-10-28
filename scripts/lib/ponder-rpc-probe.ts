/**
 * Sole owner of Ponder RPC capability probing.
 * Maintainer runs this before any commercial `.env` RPC / getLogs window change.
 */
import {
  commercialPonderRegistryAddresses,
  PonderEnvRefusalError,
  resolveChainStartBlockWithKey,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "./ponder-env.js";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "./load-deployment.js";

/** Per-request bound for probe JSON-RPC (ADR 0012). */
export const PONDER_RPC_PROBE_TIMEOUT_MS = 10_000;

export type PonderRpcProbeVerdict =
  | "ok"
  | "chain_mismatch"
  | "history_pruned"
  | "window_rejected"
  | "rate_limited"
  | "log_set_mismatch"
  | "unreachable"
  | "rpc_error"
  | "empty_reference";

export type PonderRpcProviderResult = {
  url: string;
  chainId: number;
  verdict: PonderRpcProbeVerdict;
  detail?: string;
};

export type PonderRpcProbeResult = {
  chainId: number;
  startBlock: number;
  window: number;
  addresses: `0x${string}`[];
  providers: PonderRpcProviderResult[];
  ok: boolean;
};

export type PonderRpcProbeDeps = {
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
};

type JsonRpcResponse = {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

function toHexBlock(n: number): string {
  return `0x${n.toString(16)}`;
}

function canonicalizeLogs(logs: unknown): string {
  if (!Array.isArray(logs)) return JSON.stringify(logs);
  const normalized = logs.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const e = entry as Record<string, unknown>;
    return {
      address: typeof e.address === "string" ? e.address.toLowerCase() : e.address,
      topics: e.topics,
      data: e.data,
      blockNumber: e.blockNumber,
      transactionHash: e.transactionHash,
      logIndex: e.logIndex,
    };
  });
  return JSON.stringify(normalized);
}

const WINDOW_REJECTED_PATTERNS = [
  /limited to a \d+ range/i,
  /exceeded max allowed range/i,
  /maximum allowed number of requested blocks/i,
  /block range limit exceeded/i,
  /ranges over .+ not supported/i,
] as const;

export function isWindowRejectedMessage(message: string): boolean {
  return WINDOW_REJECTED_PATTERNS.some((re) => re.test(message));
}

async function jsonRpc(
  fetchFn: typeof globalThis.fetch,
  url: string,
  method: string,
  params: unknown[],
): Promise<{ httpStatus: number; body: JsonRpcResponse }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(PONDER_RPC_PROBE_TIMEOUT_MS),
  });
  const text = await res.text();
  let body: JsonRpcResponse;
  try {
    body = JSON.parse(text) as JsonRpcResponse;
  } catch {
    body = {
      error: { message: `non_json_body status=${res.status}` },
    };
  }
  return { httpStatus: res.status, body };
}

/**
 * Classify a JSON-RPC / HTTP failure. Never defaults to window_rejected —
 * that verdict is reserved for explicit range-limit messages.
 */
function classifyRpcFailure(
  httpStatus: number,
  body: JsonRpcResponse,
): Exclude<
  PonderRpcProbeVerdict,
  "ok" | "log_set_mismatch" | "chain_mismatch" | "empty_reference"
> {
  const msg = body.error?.message ?? "";
  const msgLower = msg.toLowerCase();
  const code = body.error?.code;
  if (
    httpStatus === 429 ||
    msgLower.includes("rate") ||
    msgLower.includes("too many") ||
    code === 429
  ) {
    return "rate_limited";
  }
  if (
    msgLower.includes("prun") ||
    msgLower.includes("history") ||
    msgLower.includes("missing trie") ||
    msgLower.includes("not available") ||
    msgLower.includes("first available")
  ) {
    return "history_pruned";
  }
  if (isWindowRejectedMessage(msg)) {
    return "window_rejected";
  }
  return "rpc_error";
}

export function commercialPonderProbeChainIds(): readonly number[] {
  return [SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID];
}

/**
 * Probe every provider in `PONDER_RPC_URLS_<chainId>` at the configured
 * getLogs window against all commercial Ponder registry addresses.
 */
export async function probePonderRpcCapability(
  chainId: number,
  deps?: PonderRpcProbeDeps,
): Promise<PonderRpcProbeResult> {
  const env = deps?.env ?? process.env;
  const fetchFn = deps?.fetch ?? globalThis.fetch.bind(globalThis);

  const addresses = commercialPonderRegistryAddresses(chainId);
  const { startBlock: startRaw, envKey: startEnvKey } =
    resolveChainStartBlockWithKey(chainId);
  if (startRaw === "latest" || typeof startRaw !== "number") {
    throw new PonderEnvRefusalError(
      "probe_requires_numeric_start_block",
      startEnvKey,
      `probe_requires_numeric_start_block: chain ${chainId} start is ${String(startRaw)}`,
    );
  }
  const startBlock = startRaw;
  const window = resolveGetLogsBlockRange(chainId, env);
  const urls = resolveCommercialRpcUrls(chainId, env);
  const toBlock = startBlock + window - 1;

  const providers: PonderRpcProviderResult[] = [];
  let referenceLogSet: string | undefined;

  for (const url of urls) {
    let verdict: PonderRpcProbeVerdict = "ok";
    let detail: string | undefined;
    let logSet: string | undefined;

    try {
      const chainRes = await jsonRpc(fetchFn, url, "eth_chainId", []);
      if (chainRes.httpStatus === 429 || chainRes.body.error) {
        verdict = classifyRpcFailure(chainRes.httpStatus, chainRes.body);
        detail = chainRes.body.error?.message ?? `http ${chainRes.httpStatus}`;
      } else {
        const reported = Number.parseInt(String(chainRes.body.result), 16);
        if (reported !== chainId) {
          verdict = "chain_mismatch";
          detail = `reported_chain_id=${reported}`;
        }
      }

      if (verdict === "ok") {
        const blockRes = await jsonRpc(fetchFn, url, "eth_getBlockByNumber", [
          toHexBlock(startBlock),
          false,
        ]);
        if (blockRes.httpStatus === 429) {
          verdict = "rate_limited";
          detail = `http ${blockRes.httpStatus}`;
        } else if (blockRes.body.error) {
          verdict = classifyRpcFailure(blockRes.httpStatus, blockRes.body);
          detail = blockRes.body.error.message;
        } else if (blockRes.body.result == null) {
          verdict = "history_pruned";
          detail = `eth_getBlockByNumber(${startBlock}) returned null`;
        } else {
          const block = blockRes.body.result as { number?: string };
          const got = Number.parseInt(String(block.number), 16);
          if (got !== startBlock) {
            verdict = "history_pruned";
            detail = `block_number_mismatch got=${got} want=${startBlock}`;
          }
        }
      }

      if (verdict === "ok") {
        const logsRes = await jsonRpc(fetchFn, url, "eth_getLogs", [
          {
            fromBlock: toHexBlock(startBlock),
            toBlock: toHexBlock(toBlock),
            address: addresses,
          },
        ]);
        if (logsRes.httpStatus === 429) {
          verdict = "rate_limited";
          detail = `http ${logsRes.httpStatus}`;
        } else if (logsRes.body.error) {
          verdict = classifyRpcFailure(logsRes.httpStatus, logsRes.body);
          detail = logsRes.body.error.message;
        } else if (!Array.isArray(logsRes.body.result)) {
          verdict = "rpc_error";
          detail = "eth_getLogs result is not an array";
        } else if (logsRes.body.result.length === 0) {
          verdict = "empty_reference";
          detail = "eth_getLogs returned no logs for registry addresses";
          logSet = canonicalizeLogs(logsRes.body.result);
        } else {
          logSet = canonicalizeLogs(logsRes.body.result);
        }
      }
    } catch (err) {
      verdict = "unreachable";
      detail = err instanceof Error ? err.message : String(err);
    }

    if (verdict === "ok" && logSet !== undefined) {
      if (referenceLogSet === undefined) {
        referenceLogSet = logSet;
      } else if (logSet !== referenceLogSet) {
        verdict = "log_set_mismatch";
        detail = "eth_getLogs result differs from first provider in the list";
      }
    }

    // First successful empty set already marked empty_reference; later empty
    // against a non-empty reference is a mismatch; later empty with no prior
    // ok reference stays empty_reference.
    if (verdict === "empty_reference" && referenceLogSet !== undefined) {
      verdict = "log_set_mismatch";
      detail = "eth_getLogs empty while prior provider returned logs";
    }

    providers.push({
      url,
      chainId,
      verdict,
      ...(detail ? { detail } : {}),
    });
  }

  return {
    chainId,
    startBlock,
    window,
    addresses,
    providers,
    ok: providers.every((p) => p.verdict === "ok"),
  };
}

export async function probeAllCommercialPonderRpcs(
  deps?: PonderRpcProbeDeps,
): Promise<PonderRpcProbeResult[]> {
  const out: PonderRpcProbeResult[] = [];
  for (const chainId of commercialPonderProbeChainIds()) {
    out.push(await probePonderRpcCapability(chainId, deps));
  }
  return out;
}
