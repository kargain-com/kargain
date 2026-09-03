/**
 * Shared latest-per-author-per-d live subscription engine — fake pool tests:
 * per-(author, d) merge + NIP-01 tie-break (delegated to the app-event
 * store's mergeLatestPerAuthorPerD), fail-closed mapEvent drops, kind gate,
 * progressive flush, EOSE/timeout settle, live emission, and teardown.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Event, Filter } from "nostr-tools";

import type { LatestPerAuthorPerDPolicy } from "../lib/nostr/app-event-store.ts";
import {
  subscribeLatestPerAuthorPerD,
  type LiveSubscribePool,
} from "../lib/nostr/live-policy-subscription.ts";

const POLICY: LatestPerAuthorPerDPolicy = {
  kind: 31860,
  strategy: "latest-per-author-per-d",
};

const FILTER: Filter = { kinds: [POLICY.kind], "#d": ["claim-1"] };

const FAST_TIMING = { progressiveFlushMs: 5, initialLoadTimeoutMs: 40 };

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "e1",
    pubkey: "author-a",
    kind: POLICY.kind,
    tags: [["d", "claim-1"]],
    content: "ok:v1",
    created_at: 1_700_000_000,
    sig: "",
    ...overrides,
  } as Event;
}

/** Fail-closed mapper: contents not starting with `ok` are invalid. */
function mapOkContent(event: Event): string | null {
  return event.content.startsWith("ok") ? event.content : null;
}

type PoolHandlers = {
  onevent: (event: Event) => void;
  oneose?: () => void;
  onclose?: (reasons: string[]) => void;
};

function fakePool() {
  const state: { handlers: PoolHandlers | null; closeCount: number } = {
    handlers: null,
    closeCount: 0,
  };
  const pool: LiveSubscribePool = {
    subscribeMany: (_relays, _filter, params) => {
      state.handlers = params;
      return {
        close: () => {
          state.closeCount += 1;
        },
      };
    },
  };
  return { pool, state };
}

function collect() {
  const emissions: string[][] = [];
  let initialDoneCount = 0;
  let resolveFirstEntries: (() => void) | null = null;
  let resolveInitialDone: (() => void) | null = null;
  const whenFirstEntries = new Promise<void>((resolve) => {
    resolveFirstEntries = resolve;
  });
  const whenInitialDone = new Promise<void>((resolve) => {
    resolveInitialDone = resolve;
  });
  return {
    emissions,
    whenFirstEntries,
    whenInitialDone,
    callbacks: {
      onEntries: (entries: string[]) => {
        emissions.push(entries);
        resolveFirstEntries?.();
        resolveFirstEntries = null;
      },
      onInitialLoadDone: () => {
        initialDoneCount += 1;
        resolveInitialDone?.();
        resolveInitialDone = null;
      },
    },
    get initialDoneCount() {
      return initialDoneCount;
    },
  };
}

/** Resolves after `ms` — only to prove a progressive timer did not fire after close. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("subscribeLatestPerAuthorPerD — merge", () => {
  it("keeps the newest event per (author, d) and both authors", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onevent(makeEvent({ id: "e1", content: "ok:old" }));
    state.handlers?.onevent(
      makeEvent({ id: "e2", content: "ok:new", created_at: 1_700_000_100 }),
    );
    state.handlers?.onevent(
      makeEvent({ id: "e3", pubkey: "author-b", content: "ok:b" }),
    );
    state.handlers?.oneose?.();

    assert.deepEqual(out.emissions.at(-1), ["ok:new", "ok:b"]);
    assert.equal(out.initialDoneCount, 1);
    close();
  });

  it("ignores an older event for the same (author, d)", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onevent(
      makeEvent({ id: "e2", content: "ok:new", created_at: 1_700_000_100 }),
    );
    state.handlers?.onevent(makeEvent({ id: "e1", content: "ok:old" }));
    state.handlers?.oneose?.();

    assert.deepEqual(out.emissions.at(-1), ["ok:new"]);
    close();
  });

  it("resolves created_at ties to the lower event id", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onevent(makeEvent({ id: "e9", content: "ok:e9" }));
    state.handlers?.onevent(makeEvent({ id: "e1", content: "ok:e1" }));
    state.handlers?.oneose?.();
    assert.deepEqual(out.emissions.at(-1), ["ok:e1"]);

    close();
  });
});

describe("subscribeLatestPerAuthorPerD — fail-closed gates", () => {
  it("drops events the mapper rejects — an invalid newer event never displaces a valid older one", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onevent(makeEvent({ id: "e1", content: "ok:valid" }));
    state.handlers?.onevent(
      makeEvent({ id: "e2", content: "bad", created_at: 1_700_000_100 }),
    );
    state.handlers?.oneose?.();

    assert.deepEqual(out.emissions.at(-1), ["ok:valid"]);
    close();
  });

  it("drops events whose kind does not match the policy", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onevent(makeEvent({ kind: 31861 }));
    state.handlers?.oneose?.();

    assert.deepEqual(out.emissions.at(-1), []);
    close();
  });
});

describe("subscribeLatestPerAuthorPerD — emission cadence", () => {
  it("progressively flushes before EOSE", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    // Settle budget must not race progressive flush — fixture owns the window.
    const timing = { progressiveFlushMs: 5, initialLoadTimeoutMs: 60_000 };
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, timing,
    );

    state.handlers?.onevent(makeEvent());
    assert.equal(out.emissions.length, 0);
    await out.whenFirstEntries;
    assert.deepEqual(out.emissions, [["ok:v1"]]);
    assert.equal(out.initialDoneCount, 0);
    close();
  });

  it("settles via the safety timeout when no EOSE arrives", async () => {
    const { pool } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    await out.whenInitialDone;
    assert.equal(out.initialDoneCount, 1);
    assert.deepEqual(out.emissions, [[]]);
    close();
  });

  it("settles once on relay close and emits live events immediately after", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, FAST_TIMING,
    );

    state.handlers?.onclose?.([]);
    state.handlers?.oneose?.();
    assert.equal(out.initialDoneCount, 1);
    assert.deepEqual(out.emissions, [[]]);

    state.handlers?.onevent(makeEvent());
    assert.deepEqual(out.emissions.at(-1), ["ok:v1"]);
    assert.equal(out.emissions.length, 2);
    close();
  });

  it("stops emitting and closes the subscription on teardown", async () => {
    const { pool, state } = fakePool();
    const out = collect();
    const progressiveFlushMs = 5;
    const timing = { progressiveFlushMs, initialLoadTimeoutMs: 60_000 };
    const close = subscribeLatestPerAuthorPerD(
      pool, ["wss://r"], FILTER, POLICY, mapOkContent, out.callbacks, timing,
    );

    state.handlers?.onevent(makeEvent());
    close();
    assert.equal(state.closeCount, 1);

    // If close failed to clear the progressive timer, whenFirstEntries wins.
    const leakedFlush = await Promise.race([
      out.whenFirstEntries.then(() => true),
      wait(progressiveFlushMs + 15).then(() => false),
    ]);
    assert.equal(leakedFlush, false, "progressive flush must not fire after close");

    state.handlers?.onevent(makeEvent({ id: "e2", created_at: 1_700_000_100 }));
    state.handlers?.oneose?.();
    assert.equal(out.emissions.length, 0);
    assert.equal(out.initialDoneCount, 0);
  });
});
