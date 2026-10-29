/**
 * ADR 0012 deploy preflight — negative controls (red before green).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import {
  buildSvmIngestRuntime,
  SvmIngestRuntimeRefusalError,
  type FollowedProgram,
  type SvmIngestRuntime,
} from "../lib/svm/ingest-config.ts";
import {
  isSolanaRpcUnreachableError,
  postSolanaJsonRpc,
  type SolanaJsonRpcPost,
} from "../lib/svm/solana-json-rpc.ts";
import {
  PonderEnvRefusalError,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
  resolveChainStartBlockWithKey,
  resolvePonderRpcUrls,
} from "../scripts/lib/ponder-env.ts";
import {
  PONDER_RPC_PROBE_TIMEOUT_MS,
  ponderPreflightProbeChainIds,
  ponderRpcProbeVerdictRefusesDeploy,
  probePonderRpcCapability,
} from "../scripts/lib/ponder-rpc-probe.ts";
import { runPonderDeployPreflight } from "../scripts/ponder-deploy-preflight.ts";
import { LOCALHOST_CHAIN_ID } from "../lib/web3/local-chain.js";
import {
  runSvmIngestDeployPreflight,
  SVM_INGEST_PREFLIGHT_TIMEOUT_MS,
} from "../scripts/svm-ingest-deploy-preflight.ts";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "../scripts/lib/load-deployment.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLANTED_HOST = "planted-provider.example";
const PLANTED_HTTPS = `https://${PLANTED_HOST}/rpc`;
const RPC_A = "https://rpc-a.example";
const RPC_B = "https://rpc-b.example";

function captureWrite(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(line);
    },
  };
}

function baseCommercialEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`]: "https://rpc-a.example",
    [`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`]: "https://rpc-b.example",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`]: "1000",
    [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE_CHAIN_ID}`]: "1000",
    [`PONDER_START_BLOCK_${SEPOLIA_CHAIN_ID}`]: "100",
    [`PONDER_START_BLOCK_${SPOKE_CHAIN_ID}`]: "200",
    ...extra,
  } as NodeJS.ProcessEnv;
}

function happyFetch(): typeof fetch {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    if (body.method === "eth_chainId") {
      const url = String(input);
      const chain =
        url.includes("rpc-a") ? SEPOLIA_CHAIN_ID : SPOKE_CHAIN_ID;
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: `0x${chain.toString(16)}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (body.method === "eth_getBlockByNumber") {
      const blockHex = (body.params[0] as string) ?? "0x0";
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { number: blockHex },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (body.method === "eth_getLogs") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: [
            {
              address: "0x0000000000000000000000000000000000000001",
              topics: [],
              data: "0x",
              blockNumber: "0x64",
              transactionHash: "0xabc",
              logIndex: "0x0",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: { message: "unknown" } }), {
      status: 500,
    });
  };
}

function hangingFetch(): typeof fetch {
  return async (_input, init) => {
    await new Promise<never>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason ?? new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(signal.reason ?? new Error("aborted"));
      });
    });
    throw new Error("unreachable");
  };
}

/** Start-block resolution reads process.env, not the probe deps env. */
function withNumericStartBlocks<T>(fn: () => Promise<T>): Promise<T> {
  const prev84532 = process.env.PONDER_START_BLOCK_84532;
  const prev11155111 = process.env.PONDER_START_BLOCK_11155111;
  process.env.PONDER_START_BLOCK_84532 = "100";
  process.env.PONDER_START_BLOCK_11155111 = "200";
  return fn().finally(() => {
    if (prev84532 === undefined) delete process.env.PONDER_START_BLOCK_84532;
    else process.env.PONDER_START_BLOCK_84532 = prev84532;
    if (prev11155111 === undefined) {
      delete process.env.PONDER_START_BLOCK_11155111;
    } else {
      process.env.PONDER_START_BLOCK_11155111 = prev11155111;
    }
  });
}

type RpcOut = {
  httpStatus?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function jsonRpcResponse(out: RpcOut): Response {
  return new Response(
    JSON.stringify(
      out.error
        ? { jsonrpc: "2.0", id: 1, error: out.error }
        : { jsonrpc: "2.0", id: 1, result: out.result },
    ),
    {
      status: out.httpStatus ?? 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function chainIdForUrl(url: string): number {
  if (url.includes("rpc-b") || url.includes("spoke")) return SPOKE_CHAIN_ID;
  return SEPOLIA_CHAIN_ID;
}

function startHexForUrl(url: string): string {
  const start = chainIdForUrl(url) === SPOKE_CHAIN_ID ? 200 : 100;
  return `0x${start.toString(16)}`;
}

function sampleLog(address = "0x0000000000000000000000000000000000000001") {
  return {
    address,
    topics: [] as string[],
    data: "0x",
    blockNumber: "0x64",
    transactionHash: "0xabc",
    logIndex: "0x0",
  };
}

/** Happy path for one URL, with optional per-method overrides. */
function providerFetch(
  handlers: Record<
    string,
    (method: string, params: unknown[]) => RpcOut | "throw"
  >,
): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    const handler = handlers[url];
    if (!handler) {
      return jsonRpcResponse({ error: { message: `unknown url ${url}` } });
    }
    const out = handler(body.method, body.params ?? []);
    if (out === "throw") throw new Error(`unreachable ${url}`);
    return jsonRpcResponse(out);
  };
}

function happyProvider(url: string, overrides?: {
  chainIdHex?: string;
  blockNull?: boolean;
  logs?: unknown;
  getLogsError?: { code?: number; message?: string };
  getLogsStatus?: number;
  rateLimitAll?: boolean;
}): (method: string, params: unknown[]) => RpcOut | "throw" {
  return (method) => {
    if (overrides?.rateLimitAll) {
      return {
        httpStatus: 429,
        error: { message: "Too Many Requests" },
      };
    }
    if (method === "eth_chainId") {
      return {
        result:
          overrides?.chainIdHex ??
          `0x${chainIdForUrl(url).toString(16)}`,
      };
    }
    if (method === "eth_getBlockByNumber") {
      if (overrides?.blockNull) return { result: null };
      return { result: { number: startHexForUrl(url) } };
    }
    if (method === "eth_getLogs") {
      if (overrides?.getLogsError) {
        return {
          httpStatus: overrides.getLogsStatus,
          error: overrides.getLogsError,
        };
      }
      return { result: overrides?.logs ?? [sampleLog()] };
    }
    return { error: { message: `unexpected ${method}` } };
  };
}

/** Child-process CLI with a controlled env (deletes keys set to undefined). */
function runPreflightCli(
  scriptRel: string,
  envOverrides: NodeJS.ProcessEnv,
): { status: number | null; combined: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  // Force ponder.config to see our overrides, not a developer .env bleed.
  delete env.PONDER_ENABLE_LOCAL;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptRel],
    {
      cwd: ROOT,
      encoding: "utf8",
      env,
      timeout: 60_000,
    },
  );
  return {
    status: result.status,
    combined: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

describe("deploy-preflight typed refusals", () => {
  it("missing PONDER_RPC_URLS_<id> refuses with missing_rpc_urls", () => {
    assert.throws(
      () => resolveCommercialRpcUrls(SEPOLIA_CHAIN_ID, {}),
      (err: unknown) =>
        err instanceof PonderEnvRefusalError &&
        err.code === "missing_rpc_urls" &&
        err.envKey === `PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`,
    );
  });

  it("missing PONDER_GETLOGS_BLOCK_RANGE_<id> refuses with missing_getlogs_block_range", () => {
    assert.throws(
      () => resolveGetLogsBlockRange(SEPOLIA_CHAIN_ID, {}),
      (err: unknown) =>
        err instanceof PonderEnvRefusalError &&
        err.code === "missing_getlogs_block_range" &&
        err.envKey === `PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`,
    );
  });

  it("invalid start block refuses with invalid_start_block", () => {
    const prev = process.env.PONDER_START_BLOCK_84532;
    process.env.PONDER_START_BLOCK_84532 = "not-a-block";
    try {
      assert.throws(
        () => resolveChainStartBlockWithKey(SEPOLIA_CHAIN_ID),
        (err: unknown) =>
          err instanceof PonderEnvRefusalError &&
          err.code === "invalid_start_block" &&
          err.envKey === "PONDER_START_BLOCK_84532",
      );
    } finally {
      if (prev === undefined) delete process.env.PONDER_START_BLOCK_84532;
      else process.env.PONDER_START_BLOCK_84532 = prev;
    }
  });

  it("missing SOLANA_RPC_URL refuses with missing_solana_rpc_url", () => {
    assert.throws(
      () =>
        buildSvmIngestRuntime({
          SVM_INGEST_DATABASE_URL: "postgresql://x",
        } as NodeJS.ProcessEnv),
      (err: unknown) =>
        err instanceof SvmIngestRuntimeRefusalError &&
        err.code === "missing_solana_rpc_url" &&
        err.envKey === "SOLANA_RPC_URL",
    );
  });

  it("empty SVM_INGEST_DATABASE_URL falls back to DATABASE_URL", () => {
    const rt = buildSvmIngestRuntime({
      SOLANA_RPC_URL: "https://solana.example",
      SVM_INGEST_DATABASE_URL: "   ",
      DATABASE_URL: "postgresql://fallback",
      SVM_INGEST_EID: "40168",
    } as NodeJS.ProcessEnv);
    assert.equal(rt.databaseUrl, "postgresql://fallback");
  });
});

describe("deploy-preflight CLI child process (real ponder.config)", () => {
  it("missing PONDER_RPC_URLS refuses via real config load", () => {
    const { status, combined } = runPreflightCli(
      "scripts/ponder-deploy-preflight.ts",
      {
        [`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`]: undefined,
        [`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`]: undefined,
        [`PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`]: "1000",
        [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE_CHAIN_ID}`]: "1000",
      },
    );
    assert.equal(status, 1);
    assert.match(
      combined,
      /deploy_preflight service=ponder verdict=refused reason=missing_rpc_urls/,
    );
    assert.doesNotMatch(combined, /deploy_evidence/);
    assert.doesNotMatch(combined, /https:\/\//);
  });

  it("invalid_rpc_url planting https:// never leaks on stdout/stderr", () => {
    // Value fails URL parse but embeds https:// in the refusal message.
    const planted = `x ${PLANTED_HTTPS}`;
    const { status, combined } = runPreflightCli(
      "scripts/ponder-deploy-preflight.ts",
      {
        [`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`]: planted,
        [`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`]: "https://rpc-b.example",
        [`PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`]: "1000",
        [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE_CHAIN_ID}`]: "1000",
      },
    );
    assert.equal(status, 1);
    assert.match(
      combined,
      /deploy_preflight service=ponder verdict=refused reason=invalid_rpc_url/,
    );
    assert.doesNotMatch(combined, /https:\/\//);
    assert.doesNotMatch(combined, new RegExp(PLANTED_HOST));
    assert.doesNotMatch(combined, /deploy_evidence/);
  });

  it("svm-ingest missing SOLANA_RPC_URL refuses via real CLI", () => {
    const { status, combined } = runPreflightCli(
      "scripts/svm-ingest-deploy-preflight.ts",
      {
        SOLANA_RPC_URL: undefined,
        SVM_INGEST_DATABASE_URL: "postgresql://x",
        SVM_INGEST_EID: "40168",
      },
    );
    assert.equal(status, 1);
    assert.match(
      combined,
      /deploy_preflight service=svm-ingest verdict=refused reason=missing_solana_rpc_url/,
    );
    assert.doesNotMatch(combined, /deploy_evidence/);
    assert.doesNotMatch(combined, /https:\/\//);
  });
});

describe("deploy-preflight ponder script", () => {
  it("probe failure refuses with rpc_probe_failed and per-provider lines", async () => {
    const { lines, write } = captureWrite();
    const badFetch: typeof fetch = async () => {
      throw new Error(`boom ${PLANTED_HTTPS}`);
    };
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => ({}),
      env: baseCommercialEnv(),
      fetch: badFetch,
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    const joined = lines.join("");
    assert.match(joined, /verdict=unreachable/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
    assert.doesNotMatch(joined, /deploy_evidence/);
    assert.doesNotMatch(joined, /planted-provider/);
    assert.doesNotMatch(joined, /https:\/\//);
  });

  it("hanging provider yields unreachable within the timeout bound", async () => {
    const { lines, write } = captureWrite();
    const started = Date.now();
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => ({}),
      env: baseCommercialEnv({
        [`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`]: "https://hang-a.example",
        [`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`]: "https://hang-b.example",
      }),
      fetch: hangingFetch(),
      stdoutWrite: write,
    });
    const elapsed = Date.now() - started;
    assert.equal(code, 1);
    assert.match(lines.join(""), /verdict=unreachable/);
    assert.match(lines.join(""), /reason=rpc_probe_failed/);
    assert.ok(
      elapsed < PONDER_RPC_PROBE_TIMEOUT_MS * 3 * 2 + 5_000,
      `elapsed ${elapsed}ms exceeds expected timeout envelope`,
    );
    assert.ok(elapsed >= PONDER_RPC_PROBE_TIMEOUT_MS - 500);
  });

  it("preflight output never includes a planted URL from an error message", async () => {
    const { lines, write } = captureWrite();
    await runPonderDeployPreflight({
      evaluateConfig: async () => {
        throw new Error(`config blew up at ${PLANTED_HTTPS}`);
      },
      stdoutWrite: write,
    });
    const joined = lines.join("");
    assert.match(joined, /reason=preflight_error/);
    assert.doesNotMatch(joined, /planted-provider/);
    assert.doesNotMatch(joined, /https:\/\//);
    assert.doesNotMatch(joined, /deploy_evidence/);
  });

  it("green path prints ok provider lines and exits 0", async () => {
    const { lines, write } = captureWrite();
    await withNumericStartBlocks(async () => {
      const code = await runPonderDeployPreflight({
        evaluateConfig: async () => ({}),
        env: baseCommercialEnv(),
        fetch: happyFetch(),
        stdoutWrite: write,
      });
      assert.equal(code, 0);
      const joined = lines.join("");
      assert.match(joined, /verdict=ok/);
      assert.doesNotMatch(joined, /refused/);
      assert.doesNotMatch(joined, /deploy_evidence/);
      for (const line of lines) {
        assert.match(
          line,
          /^deploy_preflight service=ponder chain=\d+ provider=\d+ verdict=ok\n$/,
        );
      }
    });
  });
});

describe("ADR 0013 preflight refuses on provider evidence", () => {
  async function runWithFetch(fetchFn: typeof fetch, env?: NodeJS.ProcessEnv) {
    const { lines, write } = captureWrite();
    const code = await withNumericStartBlocks(() =>
      runPonderDeployPreflight({
        evaluateConfig: async () => ({}),
        env: env ?? baseCommercialEnv(),
        fetch: fetchFn,
        stdoutWrite: write,
      }),
    );
    return { code, lines, joined: lines.join("") };
  }

  it("every provider rate_limited exits 0 with verdict lines and no refusal", async () => {
    const { code, joined, lines } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, { rateLimitAll: true }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 0);
    assert.doesNotMatch(joined, /refused/);
    assert.doesNotMatch(joined, /rpc_probe_failed/);
    for (const line of lines) {
      assert.match(
        line,
        /^deploy_preflight service=ponder chain=\d+ provider=\d+ verdict=rate_limited\n$/,
      );
    }
    assert.ok(lines.length >= 2, "expected one line per commercial provider");
  });

  it("chain_mismatch refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, { chainIdHex: "0x1" }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=chain_mismatch/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("history_pruned refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, { blockNull: true }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=history_pruned/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("window_rejected refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, {
          getLogsError: {
            code: -32012,
            message: "getLogs request exceeded max allowed range",
          },
        }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=window_rejected/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("log_set_mismatch refuses with rpc_probe_failed", async () => {
    const rpcA2 = "https://rpc-a2.example";
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, {
          logs: [sampleLog("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")],
        }),
        [rpcA2]: happyProvider(rpcA2, {
          logs: [sampleLog("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")],
        }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
      baseCommercialEnv({
        [`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`]: `${RPC_A},${rpcA2}`,
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=log_set_mismatch/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("empty_reference refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, { logs: [] }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=empty_reference/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("unreachable refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: () => "throw",
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=unreachable/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("rpc_error refuses with rpc_probe_failed", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, {
          getLogsError: { message: "Apikey not found" },
        }),
        [RPC_B]: happyProvider(RPC_B, { rateLimitAll: true }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=rpc_error/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("rate_limited with window_rejected in the same run refuses", async () => {
    const { code, joined } = await runWithFetch(
      providerFetch({
        [RPC_A]: happyProvider(RPC_A, { rateLimitAll: true }),
        [RPC_B]: happyProvider(RPC_B, {
          getLogsError: {
            code: -32012,
            message: "getLogs request exceeded max allowed range",
          },
        }),
      }),
    );
    assert.equal(code, 1);
    assert.match(joined, /verdict=rate_limited/);
    assert.match(joined, /verdict=window_rejected/);
    assert.match(
      joined,
      /deploy_preflight service=ponder verdict=refused reason=rpc_probe_failed/,
    );
  });

  it("maintainer CLI child process exits 1 when a provider answers 429", () => {
    // CLI has no fetch dep; preload patches global fetch before the probe runs.
    const dir = mkdtempSync(join(tmpdir(), "ponder-rpc-probe-429-"));
    const preload = join(dir, "fetch-429.mjs");
    writeFileSync(
      preload,
      [
        "globalThis.fetch = async () =>",
        "  new Response(",
        "    JSON.stringify({",
        "      jsonrpc: '2.0',",
        "      id: 1,",
        "      error: { message: 'Too Many Requests' },",
        "    }),",
        "    { status: 429, headers: { 'content-type': 'application/json' } },",
        "  );",
        "",
      ].join("\n"),
    );
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      env[`PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`] = RPC_A;
      env[`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`] = RPC_B;
      env[`PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`] = "1000";
      env[`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE_CHAIN_ID}`] = "1000";
      env.PONDER_START_BLOCK_84532 = "100";
      env.PONDER_START_BLOCK_11155111 = "200";
      delete env.PONDER_ENABLE_LOCAL;
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(preload).href,
          "--import",
          "tsx",
          "scripts/ponder-rpc-probe.ts",
        ],
        {
          cwd: ROOT,
          encoding: "utf8",
          env,
          timeout: 60_000,
        },
      );
      assert.equal(
        result.status,
        1,
        `expected exit 1 on rate_limited; stdout=${result.stdout} stderr=${result.stderr}`,
      );
      assert.match(
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
        /verdict=rate_limited/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("deploy-preflight svm-ingest script", () => {
  const fakePrograms: FollowedProgram[] = [
    {
      slug: "kar-passport",
      programId: "Passport111111111111111111111111111111111",
      evidenceKey: "kar_passport",
      deploySlot: 1,
    },
  ];

  function fakeRuntime(overrides?: Partial<SvmIngestRuntime>): SvmIngestRuntime {
    return {
      rpcUrl: "https://solana.example",
      databaseUrl: "postgresql://x",
      stack: {} as SvmIngestRuntime["stack"],
      namespace: 2_000_040_168,
      startSlot: 1,
      maxLagSlots: 216_000,
      maxRps: 3,
      port: 42100,
      followedPrograms: fakePrograms,
      ...overrides,
    };
  }

  it("missing SOLANA_RPC_URL refuses with missing_solana_rpc_url", async () => {
    const { lines, write } = captureWrite();
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => {
        throw new SvmIngestRuntimeRefusalError(
          "missing_solana_rpc_url",
          "SOLANA_RPC_URL required for svm-ingest",
          { envKey: "SOLANA_RPC_URL" },
        );
      },
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(lines.join(""), /reason=missing_solana_rpc_url/);
    assert.doesNotMatch(lines.join(""), /deploy_evidence/);
  });

  it("non-executable followed program refuses with program_not_executable", async () => {
    const { lines, write } = captureWrite();
    const postRpc = (async () => ({
      value: { executable: false, data: ["", "base64"] },
    })) as SolanaJsonRpcPost;
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc,
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(lines.join(""), /verdict=not_executable/);
    assert.match(lines.join(""), /reason=program_not_executable/);
    assert.doesNotMatch(lines.join(""), /https:\/\//);
  });

  it("missing program account refuses with program_account_missing", async () => {
    const { lines, write } = captureWrite();
    const postRpc = (async () => ({ value: null })) as SolanaJsonRpcPost;
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc,
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(lines.join(""), /verdict=account_missing/);
    assert.match(lines.join(""), /reason=program_account_missing/);
  });

  it("timeout / network maps to unreachable; answered RPC error to preflight_error", async () => {
    assert.equal(
      isSolanaRpcUnreachableError(
        new DOMException("The operation was aborted", "TimeoutError"),
      ),
      true,
    );
    assert.equal(
      isSolanaRpcUnreachableError(new TypeError("fetch failed")),
      true,
    );
    // Message text alone never decides — including answered RPC wording.
    assert.equal(
      isSolanaRpcUnreachableError(
        new Error("Solana RPC getAccountInfo failed: Internal error"),
      ),
      false,
    );
    assert.equal(
      isSolanaRpcUnreachableError(
        new Error(
          "Solana RPC getAccountInfo failed: network congestion / fetch failed",
        ),
      ),
      false,
    );

    const { lines: hangLines, write: hangWrite } = captureWrite();
    const hangPost = (async (_url, _method, _params, timeoutMs) => {
      assert.equal(timeoutMs, SVM_INGEST_PREFLIGHT_TIMEOUT_MS);
      throw new DOMException("The operation was aborted", "TimeoutError");
    }) as SolanaJsonRpcPost;
    const hangCode = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc: hangPost,
      stdoutWrite: hangWrite,
    });
    assert.equal(hangCode, 1);
    assert.match(hangLines.join(""), /verdict=unreachable/);
    assert.match(hangLines.join(""), /reason=program_check_unreachable/);

    const { lines: ansLines, write: ansWrite } = captureWrite();
    const answeredPost = (async () => {
      throw new Error(
        "Solana RPC getAccountInfo failed: network congestion / fetch failed",
      );
    }) as SolanaJsonRpcPost;
    const ansCode = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc: answeredPost,
      stdoutWrite: ansWrite,
    });
    assert.equal(ansCode, 1);
    assert.match(ansLines.join(""), /reason=preflight_error/);
    assert.doesNotMatch(ansLines.join(""), /unreachable/);
    assert.doesNotMatch(ansLines.join(""), /network congestion/);
    assert.doesNotMatch(ansLines.join(""), /fetch failed/);
  });

  it("executable programs exit 0 with ok lines", async () => {
    const { lines, write } = captureWrite();
    const postRpc = (async () => ({
      value: { executable: true },
    })) as SolanaJsonRpcPost;
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc,
      stdoutWrite: write,
    });
    assert.equal(code, 0);
    assert.match(lines.join(""), /verdict=ok/);
    assert.doesNotMatch(lines.join(""), /refused/);
  });
});

describe("postSolanaJsonRpc timeout", () => {
  it("with timeoutMs rejects when fetch never answers", async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = hangingFetch();
    try {
      const started = Date.now();
      await assert.rejects(
        () =>
          postSolanaJsonRpc(
            "https://hang.example",
            "getHealth",
            [],
            200,
          ),
        (err: unknown) => {
          assert.equal(isSolanaRpcUnreachableError(err), true);
          return true;
        },
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 2_000, `elapsed ${elapsed}ms — timeout did not fire`);
      assert.ok(elapsed >= 150, `elapsed ${elapsed}ms — rejected too early`);
    } finally {
      globalThis.fetch = prev;
    }
  });

  it("without timeoutMs omits AbortSignal (today's unbounded shape)", async () => {
    const prev = globalThis.fetch;
    let sawSignal: AbortSignal | undefined | null = "unset" as unknown as null;
    globalThis.fetch = (async (_input, init) => {
      sawSignal = init?.signal;
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: "ok" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    try {
      const result = await postSolanaJsonRpc(
        "https://solana.example",
        "getHealth",
        [],
      );
      assert.equal(result, "ok");
      assert.equal(sawSignal, undefined);
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("deploy-preflight ponder probe timeout", () => {
  it("jsonRpc timeout maps to unreachable verdict", async () => {
    const prevStart = process.env.PONDER_START_BLOCK_11155111;
    process.env.PONDER_START_BLOCK_11155111 = "100";
    try {
      const result = await probePonderRpcCapability(SPOKE_CHAIN_ID, {
        env: {
          [`PONDER_RPC_URLS_${SPOKE_CHAIN_ID}`]: "https://hang.example",
          [`PONDER_GETLOGS_BLOCK_RANGE_${SPOKE_CHAIN_ID}`]: "1000",
        } as NodeJS.ProcessEnv,
        fetch: hangingFetch(),
      });
      assert.equal(result.providers[0]?.verdict, "unreachable");
      assert.equal(result.ok, false);
    } finally {
      if (prevStart === undefined) delete process.env.PONDER_START_BLOCK_11155111;
      else process.env.PONDER_START_BLOCK_11155111 = prevStart;
    }
  });
});

describe("deploy-preflight local-only same probe path (Amendment rule 7)", () => {
  it("localhost missing RPC / window refuse via ponder-env (red then green)", () => {
    assert.throws(
      () => resolvePonderRpcUrls(LOCALHOST_CHAIN_ID, {}),
      (err: unknown) =>
        err instanceof PonderEnvRefusalError &&
        err.code === "missing_rpc_urls" &&
        err.envKey === `PONDER_RPC_URLS_${LOCALHOST_CHAIN_ID}`,
    );
    assert.throws(
      () => resolveGetLogsBlockRange(LOCALHOST_CHAIN_ID, {}),
      (err: unknown) =>
        err instanceof PonderEnvRefusalError &&
        err.code === "missing_getlogs_block_range" &&
        err.envKey === `PONDER_GETLOGS_BLOCK_RANGE_${LOCALHOST_CHAIN_ID}`,
    );
    // Invented defaults are gone: no silent 127.0.0.1:8545 / || 1.
    const green = resolvePonderRpcUrls(LOCALHOST_CHAIN_ID, {
      [`PONDER_RPC_URLS_${LOCALHOST_CHAIN_ID}`]: "http://127.0.0.1:8545",
    } as NodeJS.ProcessEnv);
    assert.deepEqual(green, ["http://127.0.0.1:8545"]);
    assert.equal(
      resolveGetLogsBlockRange(LOCALHOST_CHAIN_ID, {
        [`PONDER_GETLOGS_BLOCK_RANGE_${LOCALHOST_CHAIN_ID}`]: "12",
      } as NodeJS.ProcessEnv),
      12,
    );
  });

  it("localhost unreachable refuses deploy via the same verdict owner", async () => {
    const prevLocal = process.env.PONDER_LOCAL_ONLY;
    const prevEnable = process.env.PONDER_ENABLE_LOCAL;
    const prevStart = process.env.PONDER_START_BLOCK_31337;
    process.env.PONDER_LOCAL_ONLY = "1";
    process.env.PONDER_ENABLE_LOCAL = "1";
    process.env.PONDER_START_BLOCK_31337 = "1";
    try {
      const chains = ponderPreflightProbeChainIds();
      assert.deepEqual(chains, [LOCALHOST_CHAIN_ID]);
      const localEnv = {
        PONDER_LOCAL_ONLY: "1",
        PONDER_ENABLE_LOCAL: "1",
        PONDER_RPC_URLS_31337: "http://127.0.0.1:1",
        PONDER_START_BLOCK_31337: "1",
        PONDER_GETLOGS_BLOCK_RANGE_31337: "1",
      } as NodeJS.ProcessEnv;
      const result = await probePonderRpcCapability(LOCALHOST_CHAIN_ID, {
        env: localEnv,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      });
      assert.equal(result.providers[0]?.verdict, "unreachable");
      assert.equal(
        ponderRpcProbeVerdictRefusesDeploy(result.providers[0]!.verdict),
        true,
      );
      const { lines, write } = captureWrite();
      const code = await runPonderDeployPreflight({
        evaluateConfig: async () => ({}),
        env: localEnv,
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
        stdoutWrite: write,
      });
      assert.equal(code, 1);
      assert.ok(lines.some((l) => /rpc_probe_failed|refused/.test(l)));
    } finally {
      if (prevLocal === undefined) delete process.env.PONDER_LOCAL_ONLY;
      else process.env.PONDER_LOCAL_ONLY = prevLocal;
      if (prevEnable === undefined) delete process.env.PONDER_ENABLE_LOCAL;
      else process.env.PONDER_ENABLE_LOCAL = prevEnable;
      if (prevStart === undefined) delete process.env.PONDER_START_BLOCK_31337;
      else process.env.PONDER_START_BLOCK_31337 = prevStart;
    }
  });
});
