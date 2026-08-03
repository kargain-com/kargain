import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Behavioural coverage for P8 read-receipt failure model and stream recovery
 * counters — pure logic mirrors of the provider contracts.
 */

describe("read receipt failure model", () => {
  it("optimistic clear keeps unread at 0 when receipt fails; pending retries converge", async () => {
    const pending = new Set<string>();
    let unread = 2;
    let receiptOk = false;
    let receiptAttempts = 0;

    async function markConversationRead(_id: string): Promise<{ ok: true } | { ok: false }> {
      receiptAttempts += 1;
      return receiptOk ? { ok: true } : { ok: false };
    }

    function markConversationSeen(id: string) {
      unread = 0;
      void markConversationRead(id).then((result) => {
        if (!result.ok) pending.add(id);
        else pending.delete(id);
      });
    }

    async function flushPending() {
      for (const id of [...pending]) {
        const result = await markConversationRead(id);
        if (result.ok) pending.delete(id);
      }
    }

    markConversationSeen("dm-1");
    await Promise.resolve();
    assert.equal(unread, 0);
    assert.ok(pending.has("dm-1"));
    assert.equal(receiptAttempts, 1);

    receiptOk = true;
    await flushPending();
    assert.equal(pending.size, 0);
    assert.equal(receiptAttempts, 2);
    assert.equal(unread, 0);
  });
});

describe("stream failure recovery", () => {
  it("triggers exactly one recovery re-sync then stops until manual", () => {
    let recoverySyncs = 0;
    let autoRecoveryUsed = false;
    let recoveryInFlight = false;

    function onFail() {
      if (recoveryInFlight || autoRecoveryUsed) return;
      autoRecoveryUsed = true;
      recoveryInFlight = true;
      recoverySyncs += 1;
      recoveryInFlight = false;
    }

    onFail();
    onFail();
    onFail();
    assert.equal(recoverySyncs, 1);

    autoRecoveryUsed = false;
    onFail();
    assert.equal(recoverySyncs, 2);
  });
});
