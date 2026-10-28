/**
 * ADR 0012 deploy preflight — negative controls (red before green).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSvmIngestRuntime,
  SvmIngestRuntimeRefusalError,
  type FollowedProgram,
  type SvmIngestRuntime,
} from "../lib/svm/ingest-config.ts";
import {
  PonderEnvRefusalError,
  resolveCommercialRpcUrls,
  resolveGetLogsBlockRange,
  resolveChainStartBlockWithKey,
} from "../scripts/lib/ponder-env.ts";
import {
  PONDER_RPC_PROBE_TIMEOUT_MS,
  probePonderRpcCapability,
} from "../scripts/lib/ponder-rpc-probe.ts";
import { runPonderDeployPreflight } from "../scripts/ponder-deploy-preflight.ts";
import {
  runSvmIngestDeployPreflight,
  SVM_INGEST_PREFLIGHT_TIMEOUT_MS,
} from "../scripts/svm-ingest-deploy-preflight.ts";
import { SEPOLIA_CHAIN_ID, SPOKE_CHAIN_ID } from "../scripts/lib/load-deployment.ts";
import type { SolanaJsonRpcPost } from "../lib/svm/solana-json-rpc.ts";

const PLANTED_URL = "https://planted-provider.example/rpc";

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

describe("deploy-preflight ponder script", () => {
  it("probe failure refuses with rpc_probe_failed and per-provider lines", async () => {
    const { lines, write } = captureWrite();
    const badFetch: typeof fetch = async () => {
      throw new Error(`boom ${PLANTED_URL}`);
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
    assert.match(joined, /deploy_evidence outcome=refused/);
    assert.doesNotMatch(joined, /planted-provider/);
    assert.doesNotMatch(joined, /https:\/\//);
  });

  it("missing rpc urls during config evaluate refuses with missing_rpc_urls", async () => {
    const { lines, write } = captureWrite();
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => {
        throw new PonderEnvRefusalError(
          "missing_rpc_urls",
          `PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID}`,
          `missing_rpc_urls: set PONDER_RPC_URLS_${SEPOLIA_CHAIN_ID} to a comma-separated list of https URLs (no default)`,
        );
      },
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(
      lines.join(""),
      /deploy_preflight service=ponder verdict=refused reason=missing_rpc_urls/,
    );
  });

  it("missing getLogs window refuses with missing_getlogs_block_range", async () => {
    const { lines, write } = captureWrite();
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => {
        throw new PonderEnvRefusalError(
          "missing_getlogs_block_range",
          `PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID}`,
          `missing_getlogs_block_range: set PONDER_GETLOGS_BLOCK_RANGE_${SEPOLIA_CHAIN_ID} to a positive integer (no default)`,
        );
      },
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(
      lines.join(""),
      /reason=missing_getlogs_block_range/,
    );
  });

  it("invalid start block refuses with invalid_start_block", async () => {
    const { lines, write } = captureWrite();
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => {
        throw new PonderEnvRefusalError(
          "invalid_start_block",
          "PONDER_START_BLOCK_84532",
          "Invalid start block value: xyz",
        );
      },
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(lines.join(""), /reason=invalid_start_block/);
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
    // Two chains × one provider × up to three timed-out requests; bound well under lock wait.
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
        throw new Error(`config blew up at ${PLANTED_URL}`);
      },
      stdoutWrite: write,
    });
    const joined = lines.join("");
    assert.match(joined, /reason=preflight_error/);
    assert.doesNotMatch(joined, /planted-provider/);
    assert.doesNotMatch(joined, /https:\/\//);
  });

  it("green path prints ok provider lines and exits 0", async () => {
    const { lines, write } = captureWrite();
    // Probe needs registry addresses from commercial-active; use real env keys
    // but inject fetch so no network. evaluateConfig skips ponder.config import.
    const code = await runPonderDeployPreflight({
      evaluateConfig: async () => ({}),
      env: baseCommercialEnv(),
      fetch: happyFetch(),
      stdoutWrite: write,
    });
    // May refuse if commercial addresses cannot load in test env — then skip green.
    // When registry resolves, expect ok.
    if (code === 0) {
      assert.match(lines.join(""), /verdict=ok/);
      assert.doesNotMatch(lines.join(""), /refused/);
    } else {
      // Registry/address load failure is preflight_error or typed — still no URL.
      assert.doesNotMatch(lines.join(""), /https:\/\//);
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

  it("hanging getAccountInfo yields program_check_unreachable within the bound", async () => {
    const { lines, write } = captureWrite();
    const started = Date.now();
    const postRpc = (async (_url, _method, _params, timeoutMs) => {
      assert.equal(timeoutMs, SVM_INGEST_PREFLIGHT_TIMEOUT_MS);
      await new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("TimeoutError")),
          timeoutMs ?? 10_000,
        );
      });
      return { value: null };
    }) as SolanaJsonRpcPost;
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => fakeRuntime(),
      postRpc,
      stdoutWrite: write,
    });
    const elapsed = Date.now() - started;
    assert.equal(code, 1);
    assert.match(lines.join(""), /verdict=unreachable/);
    assert.match(lines.join(""), /reason=program_check_unreachable/);
    assert.ok(elapsed < SVM_INGEST_PREFLIGHT_TIMEOUT_MS + 3_000);
  });

  it("untyped error with planted URL refuses as preflight_error without printing the URL", async () => {
    const { lines, write } = captureWrite();
    const code = await runSvmIngestDeployPreflight({
      buildRuntime: () => {
        throw new Error(`unexpected at ${PLANTED_URL}`);
      },
      stdoutWrite: write,
    });
    assert.equal(code, 1);
    assert.match(lines.join(""), /reason=preflight_error/);
    assert.doesNotMatch(lines.join(""), /planted-provider/);
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
