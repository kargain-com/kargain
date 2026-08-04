/**
 * Messaging R1 — executable behavioral contract (pure machine / reconcile / effects).
 *
 * Activation defects and target architecture:
 * docs/research/messaging-activation-audit-2026.md
 * Runtime types: lib/messaging/ports.ts
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { SessionSnapshot } from "../lib/messaging/ports.ts";
import { BUILD_DEADLINE_MS } from "../lib/messaging/session-budgets.ts";
import { snapshotHasActionableNext } from "../lib/messaging/machine.ts";
import {
  advanceAndSettle,
  createControlledClock,
  disposeAllOpenSessions,
  hangUntilAbort,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";

afterEach(async () => {
  await disposeAllOpenSessions();
});

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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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

  it("cold path: hung build (post-sdk) settles by BUILD_DEADLINE_MS → timeout", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async (_a, signal) => hangUntilAbort(signal),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "timeout");
    assert.ok(xmtp.calls.buildLocal >= 1);
  });

  it("july16: hung build (post-sdk) settles by BUILD_DEADLINE_MS → timeout", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("reload: build fails → needs_signature reason=build_failed", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "build_failed" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "build_failed");
  });

  it("enable while background build fails → zero creates (failure is not mint authorisation)", async () => {
    const clock = createControlledClock();
    let releaseBuild: (() => void) | undefined;
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: null }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        buildLocal: async () =>
          new Promise((resolve) => {
            releaseBuild = () =>
              resolve({ ok: false, reason: "build_failed" });
          }),
        createWithSigner: async () => {
          throw new Error("create must not run after build_failed");
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.buildLocal, 1);
    assert.equal(xmtp.calls.createWithSigner, 0);
    releaseBuild?.();
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "build_failed");
  });

  it("disable: publishIntent(false) before local teardown", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const order: string[] = [];
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async (_a, enabled) => {
          order.push(`publish:${enabled}`);
          return { ok: true };
        },
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "disable" });
    await settleAsync(clock);
    assert.deepEqual(order, ["publish:false"]);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    assert.equal(xmtp.calls.revokeOtherInstallations, 0);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, false);
  });

  it("disable: publish failure → still active, reason=publish_failed", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async (_a, enabled) =>
          enabled ? { ok: true } : { ok: false, reason: "publish_failed" },
      },
      xmtp: {
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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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
    let resolveBuild: ((v: { ok: true; client: { __brand: "XmtpLocalClient" } }) => void) | undefined;
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, wallet, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () =>
          new Promise((resolve) => {
            resolveBuild = resolve;
          }),
      },
    });
    await settleAsync(clock);
    wallet.setAddress("0x2222222222222222222222222222222222222222");
    session.changeAddress(wallet.getAddress()!);
    resolveBuild?.({ ok: true, client: fakeClient });
    await settleAsync(clock);
    // Stale build must not publish a client for the new address.
    assert.equal(session.getXmtpClient(), null);
    assert.ok(xmtp.calls.closeLocal >= 1);
  });

  it("installation_limit on create → actionable snapshot; zero revoke/create until user acts", async () => {
    const clock = createControlledClock();
    let createCalls = 0;
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: null }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        createWithSigner: async () => {
          createCalls += 1;
          return { ok: false, reason: "installation_limit" };
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") {
      assert.equal(snap.reason, "installation_limit");
      assert.equal(snap.next, "resetIdentity");
    }
    assert.equal(createCalls, 1);
    assert.equal(xmtp.calls.revokeOtherInstallations, 0);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    const createsAfter = createCalls;
    await settleAsync(clock);
    assert.equal(createCalls, createsAfter);
    assert.equal(xmtp.calls.revokeOtherInstallations, 0);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
  });

  it("revokeOtherInstallations refuses with no current client", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: null }) },
      xmtp: {
        createWithSigner: async () => ({ ok: false, reason: "installation_limit" }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    session.dispatch({ type: "resetIdentity" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeOtherInstallations, 1);
    assert.equal(xmtp.lastRevokeOthersClient, null);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "installation_limit");
  });

  it("revokeOtherInstallations passes current client (never silently full-revoke)", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        revokeOtherInstallations: async (_a, _s, current) => {
          assert.equal(current, fakeClient);
          return { ok: true };
        },
        createWithSigner: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "resetIdentity" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeOtherInstallations, 1);
    assert.equal(xmtp.lastRevokeOthersClient, fakeClient);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("revokeAllInstallations refused while cooldown active", async () => {
    const clock = createControlledClock(1_000);
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { markRevokeAllAt, clearRevokeAllAt } = await import(
      "../lib/messaging/adapters/cache-adapter.ts"
    );
    const { getMessagingXmtpEnv } = await import("../lib/messaging/xmtp-env.ts");
    const { REVOKE_ALL_COOLDOWN_MS } = await import("../lib/messaging/session-budgets.ts");
    const { TEST_ADDRESS } = await import("./messaging-contract-harness.ts");
    const env = getMessagingXmtpEnv();
    clearRevokeAllAt(env, TEST_ADDRESS);
    markRevokeAllAt(env, TEST_ADDRESS, clock.nowMs());

    let createCalls = 0;
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: null }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        createWithSigner: async () => {
          createCalls += 1;
          if (createCalls === 1) return { ok: false, reason: "installation_limit" };
          return { ok: true, client: fakeClient };
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    assert.equal(session.isRevokeAllOnCooldown(), true);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "installation_limit");

    clock.advance(REVOKE_ALL_COOLDOWN_MS);
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 1);
    assert.equal(session.getSnapshot().state, "active");
    clearRevokeAllAt(env, TEST_ADDRESS);
  });

  it("installation_limit idle until user act — free-slot then create", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    let createCalls = 0;
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: null }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        createWithSigner: async () => {
          createCalls += 1;
          if (createCalls === 1) return { ok: false, reason: "installation_limit" };
          return { ok: true, client: fakeClient };
        },
        revokeAllInstallations: async () => ({ ok: true }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(createCalls, 1);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 1);
    assert.ok(createCalls >= 2);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("dispose closes the owned client; live set empty", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    assert.equal(xmtp.liveCount, 1);
    session.dispose();
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal >= 1);
    assert.equal(xmtp.liveCount, 0);
  });

  it("address change closes the previous client", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp, wallet } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(xmtp.liveCount, 1);
    const closesBefore = xmtp.calls.closeLocal;
    wallet.setAddress("0x2222222222222222222222222222222222222222");
    session.changeAddress(wallet.getAddress()!);
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal > closesBefore);
    session.dispose();
    await settleAsync(clock);
    assert.equal(xmtp.liveCount, 0);
  });

  it("stale build result is closed immediately (never published)", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    let resolveBuild: ((v: { ok: true; client: typeof fakeClient }) => void) | undefined;
    const { session, xmtp, wallet } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () =>
          new Promise((resolve) => {
            resolveBuild = resolve;
          }),
      },
    });
    await settleAsync(clock);
    wallet.setAddress("0x2222222222222222222222222222222222222222");
    session.changeAddress(wallet.getAddress()!);
    resolveBuild?.({ ok: true, client: fakeClient });
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal >= 1);
    assert.equal(xmtp.liveCount, 0);
    assert.equal(session.getXmtpClient(), null);
  });

  it("stale create result is closed immediately (never published)", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    let resolveCreate: ((v: { ok: true; client: typeof fakeClient }) => void) | undefined;
    const { session, xmtp, wallet } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: null }), publishIntent: async () => ({ ok: true }) },
      xmtp: {
        createWithSigner: async () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    wallet.setAddress("0x2222222222222222222222222222222222222222");
    session.changeAddress(wallet.getAddress()!);
    resolveCreate?.({ ok: true, client: fakeClient });
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal >= 1);
    assert.equal(xmtp.liveCount, 0);
  });

  it("closeLocal is idempotent; dead client does not produce error state", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispose();
    await settleAsync(clock);
    const closes = xmtp.calls.closeLocal;
    xmtp.closeLocal(fakeClient);
    xmtp.closeLocal(fakeClient);
    assert.equal(xmtp.calls.closeLocal, closes + 2);
    assert.equal(xmtp.liveCount, 0);
    assert.notEqual(session.getSnapshot().state, "error");
  });

  it("ensureDurableStorage runs before create; refusal projects storageEvictable", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: null }), publishIntent: async () => ({ ok: true }) },
      xmtp: {
        ensureDurableStorage: async () => ({ durable: false }),
        createWithSigner: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.ok(xmtp.calls.ensureDurableStorage >= 1);
    assert.ok(xmtp.calls.createWithSigner >= 1);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.storageEvictable, true);
  });

  it("contract wallet → unsupported; commands rejected", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      wallet: { address: "0x1111111111111111111111111111111111111111", kind: "contract" },
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "unsupported");
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.buildLocal, 0);
  });

  it("caches: expired/absent memos change latency only", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const handlers = {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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
      nostr: { readIntent: async () => ({ status: "answered", intent: null }) },
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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
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
      nostr: { readIntent: async () => ({ status: "answered", intent: false }) },
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
        readIntent: async () => ({ status: "answered", intent: null }),
        publishIntent: async (_a, enabled) =>
          enabled ? { ok: false, reason: "publish_failed" } : { ok: true },
      },
      xmtp: {
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
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
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

  it("disable without local client publishes false and settles disabled explicit", async () => {
    const clock = createControlledClock();
    const { session, xmtp, nostr } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "build_failed" }),
      },
    });
    await settleAsync(clock);
    const before = session.getSnapshot();
    assert.equal(before.state, "needs_signature");
    session.dispatch({ type: "disable" });
    await settleAsync(clock);
    assert.ok(nostr.publishLog.some((p) => p.enabled === false));
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") assert.equal(snap.intent, "explicit");
  });

  it("initial mount projects reconciling intent until readIntent resolves", async () => {
    const clock = createControlledClock();
    let resolveIntent: ((v: import("../lib/messaging/ports.ts").IntentReadResult) => void) | undefined;
    const { session } = openSession(clock, {
      nostr: {
        readIntent: async () =>
          new Promise((resolve) => {
            resolveIntent = resolve;
          }),
      },
    });
    const first = session.getSnapshot();
    assert.equal(first.state, "reconciling");
    if (first.state === "reconciling") assert.equal(first.op, "intent");
    resolveIntent?.({ status: "answered", intent: true });
    await settleAsync(clock);
    const after = session.getSnapshot();
    assert.notEqual(after.state, "disabled");
  });

  it("unknown registration does not block build", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.ok(xmtp.calls.buildLocal >= 1);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, true);
  });

  it("returning device: build ok → active with zero signatures", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    assert.equal(xmtp.calls.createWithSigner, 0);
    assert.ok(xmtp.calls.buildLocal >= 1);
  });

  it("intent true, no local DB → needs_signature; no create until enable", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "not_registered");
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("opfs_lock remains distinct from not_registered", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "opfs_lock" }),
      },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "opfs_lock");
  });

  it("registration unknown before build — not needs_signature not_registered", async () => {
    const clock = createControlledClock();
    const { session } = openSession(
      clock,
      {
        nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
        xmtp: {
          buildLocal: async (_a, signal) => hangUntilAbort(signal),
        },
      },
      { demand: false },
    );
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "active");
    if (snap.state === "active") assert.equal(snap.publiclyReachable, true);
    assert.equal(session.getXmtpClient(), null);
    assert.notEqual(snap.state, "needs_signature");
  });
});

describe("messaging contract — invariants", () => {
  it("invariant: no state older than its deadline", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: { buildLocal: async (_a, s) => hangUntilAbort(s) },
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
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async (_a, signal) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return await hangUntilAbort(signal);
          } finally {
            inFlight -= 1;
          }
        },
      },
    });
    await settleAsync(clock);
    assert.ok(maxInFlight <= 1);
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    assert.ok(maxInFlight <= 1);
  });

  it("invariant: only effects interpreter touches ports", async () => {
    const clock = createControlledClock();
    const { xmtp, nostr } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: true }) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    assert.ok(xmtp.calls.buildLocal >= 1);
    assert.ok(nostr.calls.readIntent >= 1);
  });

  it("invariant: every non-active/non-terminal snapshot exposes a concrete next command", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: null }) },
    });
    await settleAsync(clock);
    assertActionableNext(session.getSnapshot());
  });

  it("unanswered intent never renders onboarding absent", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "unanswered" }) },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "reconciling");
    if (snap.state === "reconciling") assert.equal(snap.op, "intent");
    assert.equal(xmtp.calls.createWithSigner, 0);
    assert.equal(xmtp.liveCount, 0);
  });

  it("answered absent intent is distinct from unanswered — shows onboarding", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => ({ status: "answered", intent: null }) },
    });
    await settleAsync(clock);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "disabled");
    if (snap.state === "disabled") assert.equal(snap.intent, "absent");
  });

  it("unanswered does not clear a previously known intent memo", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };

    const { session, xmtp, nostr } = openSession(clock, {
      cacheSeed: { intent: true },
      nostr: { readIntent: async () => ({ status: "unanswered" }) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
      },
    });
    await settleAsync(clock);
    // Cache hit short-circuits Nostr — known true preserved; unanswered never consulted.
    assert.equal(nostr.calls.readIntent, 0);
    assert.equal(session.getSnapshot().state, "active");
    assert.equal(xmtp.liveCount, 1);
  });

  it("full revoke refuses when intent publish fails — no revoke", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { clearRevokeAllAt } = await import("../lib/messaging/adapters/cache-adapter.ts");
    const { getMessagingXmtpEnv } = await import("../lib/messaging/xmtp-env.ts");
    const { TEST_ADDRESS } = await import("./messaging-contract-harness.ts");
    clearRevokeAllAt(getMessagingXmtpEnv(), TEST_ADDRESS);

    const { session, xmtp, nostr } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: true }),
        publishIntent: async () => ({ ok: false, reason: "publish_failed" }),
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        revokeAllInstallations: async () => ({ ok: true }),
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.ok(nostr.calls.publishIntent >= 1);
    assert.equal(nostr.publishLog.some((p) => p.enabled === false), true);
    assert.equal(xmtp.calls.revokeAllInstallations, 0);
    assert.equal(xmtp.liveCount, 1);
  });

  it("full revoke publishes false first then create restores true", async () => {
    const clock = createControlledClock();
    const fakeClient = { __brand: "XmtpLocalClient" as const };
    const { clearRevokeAllAt } = await import("../lib/messaging/adapters/cache-adapter.ts");
    const { getMessagingXmtpEnv } = await import("../lib/messaging/xmtp-env.ts");
    const { TEST_ADDRESS } = await import("./messaging-contract-harness.ts");
    clearRevokeAllAt(getMessagingXmtpEnv(), TEST_ADDRESS);

    let published: boolean | null = true;
    const { session, xmtp, nostr } = openSession(clock, {
      nostr: {
        readIntent: async () => ({ status: "answered", intent: published }),
        publishIntent: async (_a, enabled) => {
          published = enabled;
          return { ok: true };
        },
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        createWithSigner: async () => ({ ok: true, client: fakeClient }),
        revokeAllInstallations: async () => ({ ok: true }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 1);
    const falseIdx = nostr.publishLog.findIndex((p) => p.enabled === false);
    assert.ok(falseIdx >= 0);
    const trueAfter = nostr.publishLog.findIndex(
      (p, i) => i > falseIdx && p.enabled === true,
    );
    assert.ok(trueAfter > falseIdx);
    assert.equal(published, true);
    assert.equal(session.getSnapshot().state, "active");
    if (session.getSnapshot().state === "active") {
      assert.equal(session.getSnapshot().publiclyReachable, true);
    }
    assert.equal(xmtp.liveCount, 1);
  });
});
