/**
 * Sole owner of Ponder RPC capability probing.
 * Maintainer runs this before any commercial `.env` RPC / getLogs window change.
 */
import { requireEvmCommercialActive } from "../../lib/web3/commercial-active.js";
import {
  resolveChainStartBlock,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
} from "./ponder-env.js";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "./load-deployment.js";

export type PonderRpcProbeVerdict =
  | "ok"
  | "chain_mismatch"
  | "history_pruned"
  | "window_rejected"
  | "rate_limited"
  | "log_set_mismatch";

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
  address: `0x${string}`;
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

function classifyRpcFailure(
  httpStatus: number,
  body: JsonRpcResponse,
): Exclude<PonderRpcProbeVerdict, "ok" | "log_set_mismatch" | "chain_mismatch"> {
  const msg = (body.error?.message ?? "").toLowerCase();
  const code = body.error?.code;
  if (
    httpStatus === 429 ||
    msg.includes("rate") ||
    msg.includes("too many") ||
    code === 429
  ) {
    return "rate_limited";
  }
  if (
    msg.includes("prun") ||
    msg.includes("history") ||
    msg.includes("missing trie") ||
    msg.includes("not available") ||
    msg.includes("first available")
  ) {
    return "history_pruned";
  }
  return "window_rejected";
}

export function commercialPonderProbeChainIds(): readonly number[] {
  return [SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID];
}

/**
 * Probe every provider in `PONDER_RPC_URLS_<chainId>` at the configured
 * getLogs window against the commercial karPassport address and chain start.
 */
export async function probePonderRpcCapability(
  chainId: number,
  deps?: PonderRpcProbeDeps,
): Promise<PonderRpcProbeResult> {
  const env = deps?.env ?? process.env;
  const fetchFn = deps?.fetch ?? globalThis.fetch.bind(globalThis);

  const stack = requireEvmCommercialActive(chainId);
  const address = stack.karPassport;
  const startRaw = resolveChainStartBlock(chainId);
  if (startRaw === "latest" || typeof startRaw !== "number") {
    throw new Error(
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
        if (
          chainRes.httpStatus === 429 ||
          (chainRes.body.error?.message ?? "").toLowerCase().includes("rate")
        ) {
          verdict = "rate_limited";
          detail = chainRes.body.error?.message ?? `http ${chainRes.httpStatus}`;
        } else {
          verdict = classifyRpcFailure(chainRes.httpStatus, chainRes.body);
          detail = chainRes.body.error?.message ?? `http ${chainRes.httpStatus}`;
        }
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
            address,
          },
        ]);
        if (logsRes.httpStatus === 429) {
          verdict = "rate_limited";
          detail = `http ${logsRes.httpStatus}`;
        } else if (logsRes.body.error) {
          verdict = classifyRpcFailure(logsRes.httpStatus, logsRes.body);
          detail = logsRes.body.error.message;
        } else if (!Array.isArray(logsRes.body.result)) {
          verdict = "window_rejected";
          detail = "eth_getLogs result is not an array";
        } else {
          logSet = canonicalizeLogs(logsRes.body.result);
        }
      }
    } catch (err) {
      verdict = "window_rejected";
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
    address,
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
