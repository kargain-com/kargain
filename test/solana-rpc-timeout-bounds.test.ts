/**
 * R11 (#57): every Solana JSON-RPC path is time-bounded; timeouts classify
 * through isSolanaRpcUnreachableError only. Negative controls for hang → named outcome.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  isSolanaRpcUnreachableError,
  postSolanaJsonRpc,
  type SolanaJsonRpcPost,
} from "../lib/svm/solana-json-rpc.ts";
import {
  RETRIABLE_CATCHUP_INCIDENTS,
  isRetriableCatchupIncident,
} from "../lib/svm/ingest-refusal.ts";
import { createIngestLoop } from "../svm-ingest/ingest-loop.ts";
import {
  createSolanaRpcClient,
  SvmIngestRpcBudgetExhaustedError,
  SVM_INGEST_CONNECTION_TIMEOUT_MS,
  SVM_INGEST_GET_BLOCK_TIMEOUT_MS,
  type FetchedBlock,
  type GetBlockOutcome,
  type SignatureInfo,
  type SvmRpcClient,
} from "../svm-ingest/rpc-client.ts";
import {
  fetchProductSvmLatestBlockhash,
  SVM_PRODUCT_RPC_TIMEOUT_MS,
} from "../lib/web3/svm-rpc.ts";
import {
  SVM_BINARY_IDENTITY_RPC_TIMEOUT_MS,
  SVM_BINARY_IDENTITY_RPC_UNREACHABLE_LINE,
} from "../scripts/lib/assert-svm-binary-identity.ts";
import { SVM_SIMULATE_RPC_TIMEOUT_MS } from "../lib/passport/simulate-passport-may.ts";
import { SVM_UPGRADE_IN_PLACE_RPC_TIMEOUT_MS } from "../scripts/svm-upgrade-in-place.ts";
import {
  FIXTURE_BLOCK,
  FIXTURE_FOLLOWED_PROGRAMS,
  FIXTURE_NAMESPACE,
  FIXTURE_PASSPORT_PROGRAM,
} from "./fixtures/svm-ingest/fixture-block.ts";
import { createMemorySvmRawWriter } from "./svm-ingest-memory-writer.ts";


const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function hangingFetch(): typeof fetch {
  return (async (_input, init) => {
    const signal = init?.signal;
    if (signal == null) {
      return new Promise(() => {});
    }
    return new Promise((_resolve, reject) => {
      const onAbort = () => {
        reject(
          signal.reason ??
            new DOMException("The operation was aborted", "AbortError"),
        );
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }) as typeof fetch;
}

function okBlock(block: FetchedBlock): GetBlockOutcome {
  return { status: "ok", block };
}

function makeRpc(args: {
  head: number;
  firstAvailable?: number;
  signaturesByProgram?: Record<string, SignatureInfo[]>;
  getBlockImpl?: (slot: number) => Promise<GetBlockOutcome>;
}): SvmRpcClient {
  const callCounts = {
    getBlock: 0,
    getSignaturesForAddress: 0,
    getSlot: 0,
    getFirstAvailableBlock: 0,
  };
  return {
    callCounts,
    async getSlot() {
      callCounts.getSlot += 1;
      return args.head;
    },
    async getFirstAvailableBlock() {
      callCounts.getFirstAvailableBlock += 1;
      return args.firstAvailable ?? FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    },
    async getSignaturesForAddress(programId, opts) {
      callCounts.getSignaturesForAddress += 1;
      const all = [...(args.signaturesByProgram?.[programId] ?? [])].sort(
        (a, b) => b.slot - a.slot,
      );
      const limit = opts?.limit ?? 1_000;
      const before = opts?.before;
      const start = before
        ? all.findIndex((r) => r.signature === before) + 1
        : 0;
      return all.slice(Math.max(0, start), Math.max(0, start) + limit);
    },
    async getBlock(slot) {
      callCounts.getBlock += 1;
      if (args.getBlockImpl) return args.getBlockImpl(slot);
      return { status: "missing_block", slot };
    },
  };
}

describe("timeoutMs is required on SolanaJsonRpcPost", () => {
  it("type-level: 4th parameter is required number (not optional)", () => {
    type TimeoutParam = Parameters<SolanaJsonRpcPost>[3];
    type RequiredNumber = number extends TimeoutParam
      ? undefined extends TimeoutParam
        ? false
        : true
      : false;
    const required: RequiredNumber = true;
    assert.equal(required, true);
  });

  it("source pins timeoutMs: number (not optional)", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(
      path.join(ROOT, "lib/svm/solana-json-rpc.ts"),
      "utf8",
    );
    assert.match(src, /timeoutMs:\s*number/);
    assert.doesNotMatch(src, /timeoutMs\?:\s*number/);
    assert.match(src, /signal:\s*AbortSignal\.timeout\(timeoutMs\)/);
  });
});

describe("bound derivation floor", () => {
  it("applies max(3000, ceil_to_second(max(10*p95,3*max)))", async () => {
    const { deriveTimeoutMs, SVM_RPC_TIMEOUT_FLOOR_MS } = await import(
      "../scripts/lib/solana-rpc-timeout-bound.ts"
    );
    assert.equal(SVM_RPC_TIMEOUT_FLOOR_MS, 3_000);
    // Light class would otherwise derive to 1_000.
    assert.equal(deriveTimeoutMs(45, 60), 3_000);
    // Heavier class exceeds the floor.
    assert.equal(deriveTimeoutMs(493.4, 544.8), 5_000);
  });
});

describe("named class bounds from measurement", () => {
  it("exports per-class constants stated next to measurement + bound rule", () => {
    assert.equal(SVM_INGEST_GET_BLOCK_TIMEOUT_MS, 4_000);
    assert.equal(SVM_INGEST_CONNECTION_TIMEOUT_MS, 6_000);
    assert.equal(SVM_PRODUCT_RPC_TIMEOUT_MS, 5_000);
    assert.equal(SVM_SIMULATE_RPC_TIMEOUT_MS, 3_000);
    assert.equal(SVM_BINARY_IDENTITY_RPC_TIMEOUT_MS, 3_000);
    assert.equal(SVM_UPGRADE_IN_PLACE_RPC_TIMEOUT_MS, 7_000);
    assert.equal(
      SVM_BINARY_IDENTITY_RPC_UNREACHABLE_LINE,
      "svm_binary_identity_rpc_unreachable",
    );
  });
});

describe("ingest getBlock hang → rpc_unreachable (retriable)", () => {
  it("records rpc_unreachable and does not permanently halt; next tick can clear", async () => {
    assert.equal(isRetriableCatchupIncident("rpc_unreachable"), true);
    assert.ok(
      (RETRIABLE_CATCHUP_INCIDENTS as readonly string[]).includes(
        "rpc_unreachable",
      ),
    );

    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const slotA = FIXTURE_BLOCK.slot;
    const slotB = slotA + 1;
    let blockCalls = 0;
    const rpc = makeRpc({
      head: slotB + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          {
            signature:
              "sigA111111111111111111111111111111111111111111111111111",
            slot: slotA,
          },
          {
            signature:
              "sigB222222222222222222222222222222222222222222222222222",
            slot: slotB,
          },
        ],
      },
      getBlockImpl: async (slot) => {
        blockCalls += 1;
        if (slot === slotA) return okBlock(FIXTURE_BLOCK);
        throw new DOMException("The operation was aborted", "TimeoutError");
      },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    const refusalsBefore = writer.refusals.length;
    await loop.catchUpToHead();
    assert.equal(loop.getState().lastContiguousSlot, slotA);
    assert.equal(loop.getState().catchupIncident, "rpc_unreachable");
    assert.equal(loop.getState().halted, false);
    assert.equal(loop.isReady(), false);
    assert.ok(blockCalls >= 2);
    // Retriable transport must not append ingest_refusal (chain/sequence only).
    assert.equal(writer.refusals.length, refusalsBefore);

    // Recovery path: answering getBlock clears retriable incident (same pattern as budget).
    const recover = makeRpc({
      head: slotB + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          {
            signature:
              "sigB222222222222222222222222222222222222222222222222222",
            slot: slotB,
          },
        ],
      },
      getBlockImpl: async (slot) =>
        okBlock({
          ...FIXTURE_BLOCK,
          slot,
          transactions: [
            {
              ...FIXTURE_BLOCK.transactions[0]!,
              signature:
                "sigB222222222222222222222222222222222222222222222222222",
            },
          ],
        }),
    });
    const recoverLoop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: recover,
    });
    await recoverLoop.initCursor();
    // Still in historical_backfill from partial catch-up — drive catchUp again.
    await recoverLoop.catchUpToHead();
    assert.equal(recoverLoop.getState().catchupIncident, null);
  });
});

describe("ingest getSignaturesForAddress hang → rpc_unreachable", () => {
  it("discovery timeout records rpc_unreachable without permanent halt", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const slot = FIXTURE_BLOCK.slot;
    const okRpc = makeRpc({
      head: slot + 5,
      signaturesByProgram: {
        [FIXTURE_PASSPORT_PROGRAM]: [
          {
            signature: FIXTURE_BLOCK.transactions[0]!.signature,
            slot,
          },
        ],
      },
      getBlockImpl: async () => okBlock(FIXTURE_BLOCK),
    });
    const writer = createMemorySvmRawWriter();
    const seed = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: okRpc,
    });
    await seed.initCursor();
    await seed.catchUpToHead();
    assert.equal(seed.isReady(), true);

    const hangRpc: SvmRpcClient = {
      ...okRpc,
      async getSignaturesForAddress() {
        okRpc.callCounts.getSignaturesForAddress += 1;
        throw new DOMException("The operation was aborted", "TimeoutError");
      },
    };
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 216_000,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc: hangRpc,
    });
    await loop.initCursor();
    await loop.followOnce();
    assert.equal(loop.getState().catchupIncident, "rpc_unreachable");
    assert.equal(loop.getState().halted, false);
    assert.equal(loop.isReady(), false);
  });

  it("Connection fetch aborts within the signature-page class bound", async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = hangingFetch();
    try {
      const client = createSolanaRpcClient("http://127.0.0.1:9", {
        maxRps: 100,
        rateLimitMaxAttempts: 1,
        missingBlockRetries: 0,
      });
      const started = Date.now();
      await assert.rejects(
        () => client.getSlot(),
        (err: unknown) => {
          assert.equal(isSolanaRpcUnreachableError(err), true);
          return true;
        },
      );
      const elapsed = Date.now() - started;
      assert.ok(
        elapsed < SVM_INGEST_CONNECTION_TIMEOUT_MS + 2_000,
        `elapsed ${elapsed}ms — Connection timeout did not fire`,
      );
      assert.ok(
        elapsed >= Math.min(200, SVM_INGEST_CONNECTION_TIMEOUT_MS - 500),
        `elapsed ${elapsed}ms — rejected too early`,
      );
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("product read hang → named cause", () => {
  it("getLatestBlockhash timeout → blockhash_unavailable", async () => {
    const prev = globalThis.fetch;
    const prevEnv = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL = "http://127.0.0.1:9";
    globalThis.fetch = hangingFetch();
    try {
      // Use a short bound via direct post to prove classifier; product owner uses class constant.
      const started = Date.now();
      const result = await fetchProductSvmLatestBlockhash();
      const elapsed = Date.now() - started;
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.cause, "blockhash_unavailable");
      assert.ok(
        elapsed < SVM_PRODUCT_RPC_TIMEOUT_MS + 2_000,
        `elapsed ${elapsed}ms — product timeout did not fire`,
      );
    } finally {
      globalThis.fetch = prev;
      if (prevEnv === undefined) {
        delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
      } else {
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL = prevEnv;
      }
    }
  });
});

describe("CLI binary identity hang → named non-zero line", () => {
  it("maps unreachable to svm_binary_identity_rpc_unreachable (exit 1)", async (t) => {
    try {
      await access(path.join(ROOT, "deployments/svm-40168.json"));
    } catch {
      t.skip("deployments/svm-40168.json absent — CLI evidence gate");
      return;
    }

    const server = createServer((_req, _res) => {
      // Accept and never answer.
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const hangUrl = `http://127.0.0.1:${addr.port}`;
    try {
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/assert-svm-binary-identity.ts",
          "--eid=40168",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            SOLANA_RPC_URL: hangUrl,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const stderr: Buffer[] = [];
      child.stderr.on("data", (c: Buffer) => stderr.push(c));
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve(null);
        }, 25_000);
        child.on("exit", (c) => {
          clearTimeout(timer);
          resolve(c);
        });
      });
      assert.equal(code, 1);
      const errText = Buffer.concat(stderr).toString("utf8");
      assert.match(errText, /svm_binary_identity_rpc_unreachable/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
      });
    }
  });

  it("short hang post rejects as unreachable (CLI classifier)", async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = hangingFetch();
    try {
      await assert.rejects(
        () =>
          postSolanaJsonRpc(
            "http://127.0.0.1:9",
            "getAccountInfo",
            ["11111111111111111111111111111111", { encoding: "base64" }],
            200,
          ),
        (err: unknown) => isSolanaRpcUnreachableError(err),
      );
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("isSolanaRpcUnreachableError", () => {
  it("TimeoutError/AbortError are unreachable; plain Error is not", () => {
    assert.equal(
      isSolanaRpcUnreachableError(
        new DOMException("The operation was aborted", "TimeoutError"),
      ),
      true,
    );
    assert.equal(
      isSolanaRpcUnreachableError(
        new DOMException("The operation was aborted", "AbortError"),
      ),
      true,
    );
    assert.equal(
      isSolanaRpcUnreachableError(new Error("network congestion")),
      false,
    );
  });

  it("SvmIngestRpcBudgetExhaustedError is not unreachable", () => {
    assert.equal(
      isSolanaRpcUnreachableError(
        new SvmIngestRpcBudgetExhaustedError("budget"),
      ),
      false,
    );
  });

  it("HTTP 200 null JSON body is plain Error, not unreachable", async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("null", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await assert.rejects(
        () =>
          postSolanaJsonRpc("http://127.0.0.1:9", "getHealth", [], 1_000),
        (err: unknown) => {
          assert.equal(err instanceof Error, true);
          assert.equal(err instanceof TypeError, false);
          assert.equal(isSolanaRpcUnreachableError(err), false);
          assert.match(
            err instanceof Error ? err.message : "",
            /malformed JSON-RPC envelope/,
          );
          return true;
        },
      );
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("permanent catch-up incident appends ingest_refusal", () => {
  it("startup_retention_unavailable writes sequence_gap refusal row", async () => {
    const startSlot = FIXTURE_FOLLOWED_PROGRAMS[0]!.deploySlot;
    const rpc = makeRpc({
      head: startSlot + 10,
      firstAvailable: startSlot + 1,
      signaturesByProgram: { [FIXTURE_PASSPORT_PROGRAM]: [] },
    });
    const writer = createMemorySvmRawWriter();
    const loop = createIngestLoop({
      namespace: FIXTURE_NAMESPACE,
      startSlot,
      maxLagSlots: 10,
      followedPrograms: FIXTURE_FOLLOWED_PROGRAMS,
      writer,
      rpc,
    });
    await loop.initCursor();
    const refusalsBefore = writer.refusals.length;
    await assert.rejects(
      () => loop.catchUpToHead(),
      /required slot .* before first available block/,
    );
    assert.equal(
      loop.getState().catchupIncident,
      "startup_retention_unavailable",
    );
    assert.equal(loop.getState().halted, true);
    assert.ok(writer.refusals.length > refusalsBefore);
    const row = writer.refusals[writer.refusals.length - 1]!;
    assert.equal(row.refusalKind, "sequence_gap");
    assert.equal(
      (row.detail as { incident?: string }).incident,
      "startup_retention_unavailable",
    );
  });
});
