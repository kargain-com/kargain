/**
 * Session registry — refcount + deferred destroy (P3 / RC-5).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSessionRegistry } from "../lib/messaging/session-registry.ts";

type FakeSession = {
  id: number;
  disposed: boolean;
  dispose(): void;
  dispatch(cmd: string): string[];
};

function createFakeFactory() {
  let nextId = 1;
  const created: FakeSession[] = [];
  return {
    created,
    create(): FakeSession {
      const log: string[] = [];
      const session: FakeSession = {
        id: nextId++,
        disposed: false,
        dispose() {
          this.disposed = true;
        },
        dispatch(cmd: string) {
          log.push(cmd);
          return log;
        },
      };
      created.push(session);
      return session;
    },
  };
}

function createManualClock() {
  const pending: Array<() => void> = [];
  return {
    clock: {
      scheduleDestroy(fn: () => void) {
        pending.push(fn);
        let cancelled = false;
        return {
          cancel() {
            cancelled = true;
            const i = pending.indexOf(fn);
            if (i >= 0) pending.splice(i, 1);
          },
        };
      },
    },
    flush() {
      const batch = pending.splice(0);
      for (const fn of batch) fn();
    },
    pendingCount() {
      return pending.length;
    },
  };
}

const ADDR_A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDR_B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("messaging session registry", () => {
  it("two acquires share one session; refCount is 2", () => {
    const { clock } = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(clock);
    const first = registry.acquire(ADDR_A, factory.create);
    const second = registry.acquire(ADDR_A, factory.create);
    assert.equal(first, second);
    assert.equal(factory.created.length, 1);
    assert.equal(registry.refCount(ADDR_A), 2);
  });

  it("last release schedules destroy; flush disposes", () => {
    const manual = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    registry.acquire(ADDR_A, factory.create);
    registry.release(ADDR_A);
    assert.equal(registry.pendingDestroy(ADDR_A), true);
    assert.equal(factory.created[0]!.disposed, false);
    manual.flush();
    assert.equal(factory.created[0]!.disposed, true);
    assert.equal(registry.get(ADDR_A), null);
    assert.equal(registry.refCount(ADDR_A), 0);
  });

  it("flicker: release then acquire before destroy reuses session", () => {
    const manual = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    const first = registry.acquire(ADDR_A, factory.create);
    registry.release(ADDR_A);
    assert.equal(registry.pendingDestroy(ADDR_A), true);
    const second = registry.acquire(ADDR_A, factory.create);
    assert.equal(first, second);
    assert.equal(registry.pendingDestroy(ADDR_A), false);
    assert.equal(factory.created.length, 1);
    assert.equal(registry.refCount(ADDR_A), 1);
    manual.flush();
    assert.equal(factory.created[0]!.disposed, false);
  });

  it("A → B → A creates distinct sessions; A is destroyed after leave", () => {
    const manual = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    const sessionA1 = registry.acquire(ADDR_A, factory.create);
    registry.release(ADDR_A);
    const sessionB = registry.acquire(ADDR_B, factory.create);
    assert.notEqual(sessionA1, sessionB);
    manual.flush();
    assert.equal(sessionA1.disposed, true);
    const sessionA2 = registry.acquire(ADDR_A, factory.create);
    assert.notEqual(sessionA1, sessionA2);
    assert.equal(factory.created.length, 3);
  });

  it("idempotent release of unknown address is a no-op", () => {
    const manual = createManualClock();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    registry.release(ADDR_A);
    assert.equal(manual.pendingCount(), 0);
  });

  it("acquire is case-insensitive for the same address", () => {
    const { clock } = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(clock);
    const first = registry.acquire(ADDR_A, factory.create);
    const second = registry.acquire(ADDR_A.toLowerCase(), factory.create);
    assert.equal(first, second);
    assert.equal(registry.refCount(ADDR_A), 2);
  });

  it("RC-5: same-turn dispatch after acquire reaches the live session", () => {
    const manual = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    const session = registry.acquire(ADDR_A, factory.create);
    const log = session.dispatch("enable");
    assert.deepEqual(log, ["enable"]);
    registry.release(ADDR_A);
    // Re-acquire before destroy — dispatch still works on the same instance.
    const again = registry.acquire(ADDR_A, factory.create);
    assert.equal(again, session);
    again.dispatch("retry");
    assert.deepEqual(session.dispatch("peek"), ["enable", "retry", "peek"]);
    manual.flush();
    assert.equal(session.disposed, false);
  });

  it("genuine disconnect: destroy fires with refcount still 0", () => {
    const manual = createManualClock();
    const factory = createFakeFactory();
    const registry = createSessionRegistry<FakeSession>(manual.clock);
    const session = registry.acquire(ADDR_A, factory.create);
    registry.release(ADDR_A);
    assert.equal(registry.refCount(ADDR_A), 0);
    assert.equal(registry.pendingDestroy(ADDR_A), true);
    manual.flush();
    assert.equal(session.disposed, true);
    assert.equal(registry.get(ADDR_A), null);
  });
});
