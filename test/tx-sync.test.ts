import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INDEXER_SYNC_CONSECUTIVE_FAILURES,
  INDEXER_SYNC_INTERVAL_MS,
  INDEXER_SYNC_MAX_ATTEMPTS,
  pollUntil,
  waitForIndexerBlock,
  type IndexerBlockNumberResult,
} from "../lib/web3/tx-sync.ts";

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
