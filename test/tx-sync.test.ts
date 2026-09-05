import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TransactionReceipt } from "viem";

import {
  INDEXER_SYNC_CONSECUTIVE_FAILURES,
  INDEXER_SYNC_INTERVAL_MS,
  INDEXER_SYNC_MAX_ATTEMPTS,
  type IndexerBlockNumberResult,
  pollUntil,
  waitForIndexerBlock,
} from "../lib/web3/tx-sync.ts";
import {
  awaitEvmWriteReceipt,
  runEvmWriteLifecycle,
  type EvmWriteLifecyclePhase,
  type EvmWriteLifecycleSuccess,
} from "../lib/web3/evm-write-lifecycle.ts";
import { commercialActive } from "../lib/web3/commercial-active.ts";
import { evmSwitchChainAvailability } from "../lib/web3/active-account.ts";
import {
  txWriteAvailability,
  txWriteRefusalMessage,
} from "../lib/web3/tx-write-availability.ts";

function fakeWait() {
  const calls: number[] = [];
  return {
    calls,
    wait: async (ms: number) => {
      calls.push(ms);
    },
  };
}

function sequenceFetcher(results: IndexerBlockNumberResult[]) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fetchStatus: async () => {
      const result = results[Math.min(calls, results.length - 1)]!;
      calls += 1;
      return result;
    },
  };
}

function fixtureEvmAccount(walletChainId = 84532) {
  const stack = commercialActive(84532);
  if (!stack || stack.vm !== "evm") {
    throw new Error("Missing 84532 EVM commercial stack");
  }
  return {
    status: "connected" as const,
    vm: "evm" as const,
    address: "0x0000000000000000000000000000000000000001" as const,
    namespace: stack.namespace,
    chainId: walletChainId,
  };
}

function fakeReceipt(
  hash: `0x${string}`,
  blockNumber: bigint,
): TransactionReceipt {
  return {
    blockHash: `0x${"a".repeat(64)}`,
    blockNumber,
    contractAddress: null,
    cumulativeGasUsed: 1n,
    effectiveGasPrice: 1n,
    from: "0x0000000000000000000000000000000000000001",
    gasUsed: 1n,
    logs: [],
    logsBloom: `0x${"0".repeat(512)}`,
    status: "success",
    to: "0x0000000000000000000000000000000000000002",
    transactionHash: hash,
    transactionIndex: 0,
    type: "eip1559",
  } as TransactionReceipt;
}

type LegacyLifecycleOptions = {
  account: ReturnType<typeof fixtureEvmAccount>;
  chainId: number;
  switchChain: (chainId: number) => Promise<void>;
  writeFn: () => Promise<string>;
  fetchIndexerStatus: () => Promise<IndexerBlockNumberResult>;
  wait: (ms: number) => Promise<void>;
  onPhase?: (phase: EvmWriteLifecyclePhase) => void;
  confirmTransaction: (
    _config: never,
    hash: `0x${string}`,
  ) => Promise<TransactionReceipt>;
  resolveTargetChainId?: (chainId: number) => number;
};

async function legacyRunEvmWriteLifecycle({
  account,
  chainId,
  switchChain,
  writeFn,
  fetchIndexerStatus,
  wait,
  onPhase,
  confirmTransaction,
  resolveTargetChainId = (value) => value,
}: LegacyLifecycleOptions): Promise<EvmWriteLifecycleSuccess> {
  const avail = txWriteAvailability(account, chainId);
  if (!avail.available) {
    throw new Error(txWriteRefusalMessage(avail.cause));
  }
  onPhase?.("wallet");
  const targetChainId = resolveTargetChainId(chainId);
  if (avail.walletChainId !== targetChainId) {
    const switchAvail = evmSwitchChainAvailability(account);
    if (!switchAvail.available) {
      throw new Error(`switchChain unavailable: ${switchAvail.cause}`);
    }
    await switchChain(chainId);
  }
  const hash = await writeFn();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw new Error("Transaction hash is not a valid EVM hash.");
  }
  const txHash = hash as `0x${string}`;
  onPhase?.("confirming");
  const receipt = await confirmTransaction(undefined as never, txHash);
  onPhase?.("indexing");
  const { synced } = await waitForIndexerBlock({
    targetBlock: receipt.blockNumber,
    fetchStatus: fetchIndexerStatus,
    wait,
  });
  return {
    receipt,
    synced,
  };
}

describe("waitForIndexerBlock", () => {
  it("catches up on the first poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: true, blockNumber: 100 }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 1);
    assert.deepEqual(clock.calls, []);
  });

  it("catches up on the Nth poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: true, blockNumber: 98 },
      { ok: true, blockNumber: 99 },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 3);
    assert.deepEqual(clock.calls, [
      INDEXER_SYNC_INTERVAL_MS,
      INDEXER_SYNC_INTERVAL_MS,
    ]);
  });

  it("tolerates unavailable responses mid-poll", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: true, blockNumber: 99 },
      { ok: false },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 3);
    assert.equal(clock.calls.length, 2);
  });

  it("fast-fails after exactly three consecutive unavailable responses", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: false }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: false });
    assert.equal(status.calls, INDEXER_SYNC_CONSECUTIVE_FAILURES);
    assert.equal(clock.calls.length, INDEXER_SYNC_CONSECUTIVE_FAILURES - 1);
    assert.ok(clock.calls.every((ms) => ms === INDEXER_SYNC_INTERVAL_MS));
  });

  it("resets the consecutive-failure counter on a lagging ok response", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([
      { ok: false },
      { ok: false },
      { ok: true, blockNumber: 99 },
      { ok: false },
      { ok: false },
      { ok: true, blockNumber: 100 },
    ]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: true });
    assert.equal(status.calls, 6);
    assert.equal(clock.calls.length, 5);
  });

  it("exhausts the full attempt cap when ok responses stay behind the target", async () => {
    const clock = fakeWait();
    const status = sequenceFetcher([{ ok: true, blockNumber: 99 }]);

    const result = await waitForIndexerBlock({
      targetBlock: 100n,
      fetchStatus: status.fetchStatus,
      wait: clock.wait,
    });

    assert.deepEqual(result, { synced: false });
    assert.equal(status.calls, INDEXER_SYNC_MAX_ATTEMPTS);
    assert.equal(clock.calls.length, INDEXER_SYNC_MAX_ATTEMPTS - 1);
    assert.ok(clock.calls.every((ms) => ms === INDEXER_SYNC_INTERVAL_MS));
  });
});

describe("pollUntil", () => {
  it("matches a predicate on the first attempt", async () => {
    const clock = fakeWait();
    const result = await pollUntil({
      poll: async () => 3,
      predicate: (value) => value === 3,
      intervalMs: 25,
      maxAttempts: 4,
      wait: clock.wait,
    });

    assert.deepEqual(result, { status: "matched", value: 3, attempts: 1 });
    assert.deepEqual(clock.calls, []);
  });

  it("matches a passport-style predicate on the Nth attempt", async () => {
    const clock = fakeWait();
    const values = [
      { ok: true, indexerPending: true },
      { ok: false, indexerPending: false },
      { ok: true, indexerPending: false },
    ];
    let index = 0;

    const result = await pollUntil({
      poll: async () => values[index++]!,
      predicate: (value) => value.ok && !value.indexerPending,
      intervalMs: 3_000,
      maxAttempts: 5,
      wait: clock.wait,
    });

    assert.equal(result.status, "matched");
    assert.equal(result.attempts, 3);
    assert.deepEqual(clock.calls, [3_000, 3_000]);
  });

  it("treats poll and predicate failures as attempts", async () => {
    const clock = fakeWait();
    let attempts = 0;
    const result = await pollUntil({
      poll: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("unavailable");
        return attempts;
      },
      predicate: (value) => {
        if (value === 2) throw new Error("invalid");
        return value === 3;
      },
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
    });

    assert.deepEqual(result, { status: "matched", value: 3, attempts: 3 });
    assert.deepEqual(clock.calls, [10, 10]);
  });

  it("exhausts at the custom cap and preserves the latest value", async () => {
    const clock = fakeWait();
    let value = 0;
    const result = await pollUntil({
      poll: async () => {
        value += 1;
        return value;
      },
      predicate: () => false,
      intervalMs: 50,
      maxAttempts: 4,
      wait: clock.wait,
    });

    assert.deepEqual(result, {
      status: "exhausted",
      value: 4,
      attempts: 4,
    });
    assert.deepEqual(clock.calls, [50, 50, 50]);
  });

  it("cancels before the first poll", async () => {
    const clock = fakeWait();
    let polls = 0;
    const result = await pollUntil({
      poll: async () => {
        polls += 1;
        return false;
      },
      predicate: Boolean,
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
      shouldContinue: () => false,
    });

    assert.deepEqual(result, {
      status: "cancelled",
      value: undefined,
      attempts: 0,
    });
    assert.equal(polls, 0);
  });

  it("cancels after a poll before waiting", async () => {
    const clock = fakeWait();
    let active = true;
    const result = await pollUntil({
      poll: async () => {
        active = false;
        return "pending";
      },
      predicate: () => false,
      intervalMs: 10,
      maxAttempts: 3,
      wait: clock.wait,
      shouldContinue: () => active,
    });

    assert.deepEqual(result, {
      status: "cancelled",
      value: "pending",
      attempts: 1,
    });
    assert.deepEqual(clock.calls, []);
  });

  it("does not poll again when cancelled while waiting", async () => {
    let active = true;
    let polls = 0;
    const result = await pollUntil({
      poll: async () => {
        polls += 1;
        return false;
      },
      predicate: Boolean,
      intervalMs: 10,
      maxAttempts: 3,
      wait: async () => {
        active = false;
      },
      shouldContinue: () => active,
    });

    assert.equal(result.status, "cancelled");
    assert.equal(result.attempts, 1);
    assert.equal(polls, 1);
  });
});

describe("runEvmWriteLifecycle equivalence", () => {
  it("matches the legacy observable sequence for a successful write", async () => {
    const events: string[] = [];
    const account = fixtureEvmAccount(84532);
    const hash = `0x${"1".repeat(64)}` as const;
    const receipt = fakeReceipt(hash, 100n);
    const wait = async (ms: number) => {
      events.push(`wait:${ms}`);
    };
    const shared = {
      account,
      chainId: 84532,
      switchChain: async (target: number) => {
        events.push(`switch:${target}`);
      },
      writeFn: async () => {
        events.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => ({ ok: true, blockNumber: 100 }),
      wait,
      onPhase: (phase: EvmWriteLifecyclePhase) => {
        events.push(`phase:${phase}`);
      },
      confirmTransaction: async (_config: never, confirmedHash: `0x${string}`) => {
        events.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value: number) => value,
    } satisfies LegacyLifecycleOptions;

    const legacyEvents: string[] = [];
    const legacy = await legacyRunEvmWriteLifecycle({
      ...shared,
      onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
      switchChain: async (target) => {
        legacyEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        legacyEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        const result = {
          ok: true,
          blockNumber: legacyEvents.includes("status:99") ? 100 : 99,
        } as IndexerBlockNumberResult;
        legacyEvents.push(`status:${result.ok ? result.blockNumber : "unavailable"}`);
        return result;
      },
      wait: async (ms) => {
        legacyEvents.push(`wait:${ms}`);
      },
      confirmTransaction: async (_config, confirmedHash) => {
        legacyEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
    });

    const actual = await runEvmWriteLifecycle({
      account,
      chainId: 84532,
      config: undefined as never,
      switchChain: async (target) => {
        events.push(`switch:${target}`);
      },
      writeFn: async () => {
        events.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        const result = {
          ok: true,
          blockNumber: events.includes("status:99") ? 100 : 99,
        } as IndexerBlockNumberResult;
        events.push(`status:${result.ok ? result.blockNumber : "unavailable"}`);
        return result;
      },
      wait,
      onPhase: (phase: EvmWriteLifecyclePhase) => {
        events.push(`phase:${phase}`);
      },
      confirmTransaction: async (_config, confirmedHash) => {
        events.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value: number) => value,
    });

    assert.deepEqual(actual, legacy);
    assert.deepEqual(events, legacyEvents);
  });

  it("matches the legacy observable sequence for a wrong-chain write that switches first", async () => {
    const account = fixtureEvmAccount(11155111);
    const hash = `0x${"2".repeat(64)}` as const;
    const receipt = fakeReceipt(hash, 55n);
    const legacyEvents: string[] = [];
    const actualEvents: string[] = [];

    const legacy = await legacyRunEvmWriteLifecycle({
      account,
      chainId: 84532,
      switchChain: async (target) => {
        legacyEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        legacyEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        legacyEvents.push("status:55");
        return { ok: true, blockNumber: 55 };
      },
      wait: async (ms) => {
        legacyEvents.push(`wait:${ms}`);
      },
      onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
      confirmTransaction: async (_config, confirmedHash) => {
        legacyEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value) => value,
    });

    const actual = await runEvmWriteLifecycle({
      account,
      chainId: 84532,
      config: undefined as never,
      switchChain: async (target) => {
        actualEvents.push(`switch:${target}`);
      },
      writeFn: async () => {
        actualEvents.push("write");
        return hash;
      },
      fetchIndexerStatus: async () => {
        actualEvents.push("status:55");
        return { ok: true, blockNumber: 55 };
      },
      wait: async (ms) => {
        actualEvents.push(`wait:${ms}`);
      },
      onPhase: (phase) => actualEvents.push(`phase:${phase}`),
      confirmTransaction: async (_config, confirmedHash) => {
        actualEvents.push(`confirm:${confirmedHash}`);
        return receipt;
      },
      resolveTargetChainId: (value) => value,
    });

    assert.deepEqual(actual, legacy);
    assert.deepEqual(actualEvents, legacyEvents);
  });

  it("matches the legacy failure sequence when the write throws", async () => {
    const account = fixtureEvmAccount(84532);
    const legacyEvents: string[] = [];
    const actualEvents: string[] = [];

    await assert.rejects(
      () =>
        legacyRunEvmWriteLifecycle({
          account,
          chainId: 84532,
          switchChain: async (target) => {
            legacyEvents.push(`switch:${target}`);
          },
          writeFn: async () => {
            legacyEvents.push("write");
            throw new Error("boom");
          },
          fetchIndexerStatus: async () => {
            legacyEvents.push("status:unexpected");
            return { ok: false };
          },
          wait: async (ms) => {
            legacyEvents.push(`wait:${ms}`);
          },
          onPhase: (phase) => legacyEvents.push(`phase:${phase}`),
          confirmTransaction: async () => {
            legacyEvents.push("confirm:unexpected");
            throw new Error("unexpected");
          },
        }),
      /boom/,
    );

    await assert.rejects(
      () =>
        runEvmWriteLifecycle({
          account,
          chainId: 84532,
          config: undefined as never,
          switchChain: async (target) => {
            actualEvents.push(`switch:${target}`);
          },
          writeFn: async () => {
            actualEvents.push("write");
            throw new Error("boom");
          },
          fetchIndexerStatus: async () => {
            actualEvents.push("status:unexpected");
            return { ok: false };
          },
          wait: async (ms) => {
            actualEvents.push(`wait:${ms}`);
          },
          onPhase: (phase) => actualEvents.push(`phase:${phase}`),
          confirmTransaction: async () => {
            actualEvents.push("confirm:unexpected");
            throw new Error("unexpected");
          },
        }),
      /boom/,
    );

    assert.deepEqual(actualEvents, legacyEvents);
  });

  it("awaitEvmWriteReceipt preserves the legacy confirming path", async () => {
    const account = fixtureEvmAccount(84532);
    const hash = `0x${"3".repeat(64)}` as const;
    const phases: string[] = [];
    const receipt = fakeReceipt(hash, 77n);
    const result = await awaitEvmWriteReceipt({
      account,
      chainId: 84532,
      config: undefined as never,
      hash,
      onPhase: (phase) => phases.push(phase),
      confirmTransaction: async (_config, confirmedHash) => {
        assert.equal(confirmedHash, hash);
        return receipt;
      },
    });
    assert.equal(result.transactionHash, hash);
    assert.deepEqual(phases, ["confirming"]);
  });
});
