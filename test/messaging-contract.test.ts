/**
 * Messaging R1 — executable behavioral contract.
 *
 * Canonical spec: docs/research/messaging-rebuild.md
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUILD_DEADLINE_MS,
  PROBE_DEADLINE_MS,
  type SessionSnapshot,
} from "../lib/messaging/ports.ts";
import { snapshotHasActionableNext } from "../lib/messaging/machine.ts";
import {
  advanceAndSettle,
  createControlledClock,
  hangUntilAbort,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";

function assertDeadlineBound(snapshot: SessionSnapshot, nowMs: number): void {
  if (snapshot.state === "reconciling") {
    assert.ok(snapshot.deadlineMs >= nowMs);
  }
}

function assertActionableNext(snapshot: SessionSnapshot): void {
  if (snapshot.state === "active" && !snapshot.next) return;
  if (snapshot.state === "disconnected" || snapshot.state === "unsupported") return;
  if (snapshot.state === "reconciling") return;
  assert.ok(snapshotHasActionableNext(snapshot));
}

describe("messaging contract — scenarios", () => {
  it("cutover: intent enabled, network unregistered, no OPFS → needs_signature", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: false }),
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") {
      assert.equal(snap.reason, "not_registered");
      assert.equal(snap.next, "enable");
    }
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("july16: hung probe settles by PROBE_DEADLINE_MS → timeout", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async (_a, signal) => hangUntilAbort(signal),
      },
    });
    await advanceAndSettle(clock, PROBE_DEADLINE_MS);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "timeout");
  });

  it("july16: hung build settles by BUILD_DEADLINE_MS → timeout", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async (_a, signal) => hangUntilAbort(signal),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "timeout");
  });

  it("fresh: build succeeds → active without signature", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, true);
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("reload: silent restore succeeds → active", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("reload: build fails → needs_signature reason=build_failed", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: false, reason: "build_failed" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "build_failed");
  });

  it("enable while background build in flight → createWithSigner after settle without client", async () => {
    const clock = createControlledClock();
    let releaseBuild: (() => void) | undefined;
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp, nostr } = openSession(clock, {
      nostr: {
        readIntent: async () => null,
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () =>
          new Promise((resolve) => {
            releaseBuild = () => resolve({ ok: false, reason: "build_failed" });
          }),
        createWithSigner: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.buildLocal, 1);
    assert.equal(xmtp.calls.createWithSigner, 0);
    releaseBuild?.();
    await settleAsync(clock);
    assert.ok(xmtp.calls.createWithSigner >= 1);
    assert.ok(nostr.calls.publishIntent >= 1);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("disable: publishIntent(false) before local teardown", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const order: string[] = [];
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => true,
        publishIntent: async (_a, enabled) => {
          order.push(`publish:${enabled}`);
          return { ok: true };
        },
      },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        resetLocalDb: async () => {
          order.push("reset");
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "disable" });
    await settleAsync(clock);
    assert.deepEqual(order, ["publish:false"]);
    assert.equal(xmtp.calls.resetLocalDb, 0);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, false);
  });

  it("disable: publish failure → still active, reason=publish_failed", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () => true,
        publishIntent: async (_a, enabled) =>
          enabled ? { ok: true } : { ok: false, reason: "publish_failed" },
      },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "disable" });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") {
      assert.equal(snap.publishError, "publish_failed");
      assert.equal(snap.next, "retry");
    }
  });

  it("second tab: OPFS lock → error/opfs_lock dedicated path, no crash loop", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: false, reason: "opfs_lock" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "opfs_lock");
    const callsAfter = xmtp.calls.buildLocal;
    await settleAsync(clock);
    assert.equal(xmtp.calls.buildLocal, callsAfter);
  });

  it("address switch: stale-generation events discarded", async () => {
    const clock = createControlledClock();
    let resolveProbe: ((v: { registered: boolean }) => void) | undefined;
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, wallet } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () =>
          new Promise((resolve) => {
            resolveProbe = resolve;
          }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    wallet.setAddress("0x2222222222222222222222222222222222222222");
    // Force address observation via getSnapshot refresh.
    session.getSnapshot();
    resolveProbe?.({ registered: true });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    // Stale probe must not activate the new address without a fresh intent load.
    assert.notEqual(snap.state, "active");
  });

  it("installation_limit on create → reason + revoke→reset→create recovery", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    let createCalls = 0;
    const order: string[] = [];
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () => null,
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        probeRegistration: async () => ({ registered: false }),
        createWithSigner: async () => {
          createCalls += 1;
          if (createCalls === 1) return { ok: false, reason: "installation_limit" };
          return { ok: true, client: fakeClient };
        },
        revokeInstallations: async () => {
          order.push("revoke");
        },
        resetLocalDb: async () => {
          order.push("reset");
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.ok(order.includes("revoke"));
    assert.ok(order.includes("reset"));
    assert.ok(createCalls >= 2);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("contract wallet → unsupported; commands rejected", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      wallet: { address: "0x1111111111111111111111111111111111111111", kind: "contract" },
      nostr: { readIntent: async () => true },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "unsupported");
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.probeRegistration, 0);
  });

  it("caches: expired/absent memos change latency only", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const handlers = {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    };
    const cold = openSession(clock, handlers);
    await settleAsync(clock);
    const coldSnap = cold.session.getSnapshot();

    const clock2 = createControlledClock();
    const warm = openSession(clock2, handlers);
    await settleAsync(clock2);
    const warmSnap = warm.session.getSnapshot();

    assert.deepEqual(coldSnap, warmSnap);
  });

  it("intent absent never enabled → disabled with next=enable", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => null },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") {
      assert.equal(snap.intent, "absent");
      assert.equal(snap.next, "enable");
    }
  });

  it("create cancelled mid-signature → reason=create_cancelled", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: false }),
        createWithSigner: async (_a, signal) => hangUntilAbort(signal),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    session.dispatch({ type: "cancel" });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "create_cancelled");
  });

  it("reload while intent disabled → must not create; stay disabled", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => false },
      xmtp: {
        createWithSigner: async () => {
          throw new Error("must not create");
        },
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") assert.equal(snap.intent, "explicit");
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("enable: create ok, publishIntent(true) failed → active with next=retry (publish only)", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => null,
        publishIntent: async (_a, enabled) =>
          enabled ? { ok: false, reason: "publish_failed" } : { ok: true },
      },
      xmtp: {
        probeRegistration: async () => ({ registered: false }),
        createWithSigner: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") {
      assert.equal(snap.publishPending, true);
      assert.equal(snap.next, "retry");
      assert.equal(snap.publiclyReachable, false);
    }
    const createCalls = xmtp.calls.createWithSigner;
    session.dispatch({ type: "retry" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, createCalls);
  });

  it("explicit opt-out with local client → active publiclyReachable false", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () => true,
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    session.dispatch({ type: "disable" });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, false);
  });
});

describe("messaging contract — invariants", () => {
  it("invariant: no state older than its deadline", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: { probeRegistration: async (_a, s) => hangUntilAbort(s) },
    });
    await settleAsync(clock);
    assertDeadlineBound(session.getSnapshot(), clock.nowMs());
    clock.advance(1000);
    await settleAsync(clock);
    assertDeadlineBound(session.getSnapshot(), clock.nowMs());
  });

  it("invariant: at most one session operation in flight", async () => {
    const clock = createControlledClock();
    let inFlight = 0;
    let maxInFlight = 0;
    openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async (_a, signal) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return await hangUntilAbort<{ registered: boolean }>(signal);
          } finally {
            inFlight -= 1;
          }
        },
      },
    });
    await settleAsync(clock);
    assert.ok(maxInFlight <= 1);
    await advanceAndSettle(clock, PROBE_DEADLINE_MS);
    assert.ok(maxInFlight <= 1);
  });

  it("invariant: only effects interpreter touches ports", async () => {
    const clock = createControlledClock();
    const { xmtp, nostr } = openSession(clock, {
      nostr: { readIntent: async () => true },
      xmtp: {
        probeRegistration: async () => ({ registered: true }),
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    assert.ok(xmtp.calls.probeRegistration >= 1);
    assert.ok(nostr.calls.readIntent >= 1);
  });

  it("invariant: every non-active/non-terminal snapshot exposes a concrete next command", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => null },
    });
    await settleAsync(clock);
    assertActionableNext(session.getSnapshot());
  });
});
