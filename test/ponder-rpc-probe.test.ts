/**
 * Injected-fetch fail instruments for every ponder-rpc-probe verdict.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { probePonderRpcCapability } from "../scripts/lib/ponder-rpc-probe.ts";

const CHAIN = 11155111;
const START = 11_591_966;
const WINDOW = 1000;
const URL_A = "https://rpc-a.example";
const URL_B = "https://rpc-b.example";

function baseEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    [`PONDER_RPC_URLS_${CHAIN}`]: URL_A,
    [`PONDER_GETLOGS_BLOCK_RANGE_${CHAIN}`]: String(WINDOW),
    [`PONDER_START_BLOCK_${CHAIN}`]: String(START),
    ...extra,
  } as NodeJS.ProcessEnv;
}

type RpcHandler = (method: string, params: unknown[]) => {
  httpStatus?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function makeFetch(handlers: Record<string, RpcHandler>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method: string;
      params: unknown[];
    };
    const handler = handlers[url];
    if (!handler) {
      return new Response(JSON.stringify({ error: { message: "unknown url" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    const out = handler(body.method, body.params ?? []);
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
  };
}

function makeThrowingFetch(message: string): typeof fetch {
  return async () => {
    throw new Error(message);
  };
}

function happyHandler(overrides?: {
  chainIdHex?: string;
  blockNumberHex?: string;
  logs?: unknown;
  getLogsError?: { code?: number; message?: string };
  getLogsStatus?: number;
  blockNull?: boolean;
  chainError?: { code?: number; message?: string };
}): RpcHandler {
  return (method, params) => {
    if (method === "eth_chainId") {
      if (overrides?.chainError) {
        return { error: overrides.chainError };
      }
      return { result: overrides?.chainIdHex ?? `0x${CHAIN.toString(16)}` };
    }
    if (method === "eth_getBlockByNumber") {
      if (overrides?.blockNull) return { result: null };
      return {
        result: {
          number: overrides?.blockNumberHex ?? `0x${START.toString(16)}`,
        },
      };
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as { address?: unknown };
      assert.ok(Array.isArray(filter.address), "probe must pass address array");
      assert.ok(
        (filter.address as unknown[]).length >= 3,
        "probe must include all registry addresses",
      );
      if (overrides?.getLogsError) {
        return {
          httpStatus: overrides.getLogsStatus,
          error: overrides.getLogsError,
        };
      }
      return {
        result:
          overrides?.logs ??
          [
            {
              address: "0x1ffdec27d14567b34548ba63269c0745227f1949",
              logIndex: "0x0",
            },
          ],
      };
    }
    return { error: { message: `unexpected ${method}` } };
  };
}

describe("ponder-rpc-probe", () => {
  it("verdict ok when chain, history, and non-empty window succeed", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({ [URL_A]: happyHandler() }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.providers[0]?.verdict, "ok");
    assert.ok(result.addresses.length >= 3);
    assert.equal(result.startBlock, START);
    assert.equal(result.window, WINDOW);
  });

  it("verdict chain_mismatch", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({ chainIdHex: "0x1" }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "chain_mismatch");
  });

  it("verdict history_pruned when start block is null", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({ blockNull: true }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "history_pruned");
  });

  it("verdict window_rejected on explicit range error", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({
          getLogsError: {
            code: -32012,
            message: "getLogs request exceeded max allowed range",
          },
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "window_rejected");
  });

  it("verdict rate_limited on HTTP 429", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({
          getLogsStatus: 429,
          getLogsError: { message: "Too Many Requests" },
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "rate_limited");
  });

  it("verdict history_pruned when getLogs message names prune", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({
          getLogsError: { message: "historical state is pruned" },
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "history_pruned");
  });

  it("verdict rpc_error for unrecognized provider errors", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({
          getLogsError: { message: "Apikey not found" },
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "rpc_error");
    assert.match(result.providers[0]?.detail ?? "", /Apikey not found/);
  });

  it("verdict unreachable on network failure", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeThrowingFetch("fetch failed"),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "unreachable");
    assert.match(result.providers[0]?.detail ?? "", /fetch failed/);
  });

  it("verdict empty_reference when logs are empty", async () => {
    const result = await probePonderRpcCapability(CHAIN, {
      env: baseEnv(),
      fetch: makeFetch({
        [URL_A]: happyHandler({ logs: [] }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "empty_reference");
  });

  it("verdict log_set_mismatch when providers disagree", async () => {
    const env = baseEnv({
      [`PONDER_RPC_URLS_${CHAIN}`]: `${URL_A},${URL_B}`,
    } as NodeJS.ProcessEnv);
    const result = await probePonderRpcCapability(CHAIN, {
      env,
      fetch: makeFetch({
        [URL_A]: happyHandler({
          logs: [{ address: "0xaaa", logIndex: "0x0" }],
        }),
        [URL_B]: happyHandler({
          logs: [{ address: "0xbbb", logIndex: "0x1" }],
        }),
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.providers[0]?.verdict, "ok");
    assert.equal(result.providers[1]?.verdict, "log_set_mismatch");
  });
});
