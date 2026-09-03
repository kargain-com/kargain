/**
 * I2 — Only a completed negative registration answer authorises minting.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { createInMemoryMessagingCache } from "../lib/messaging/adapters/cache-adapter.ts";
import { createEffectsRunner } from "../lib/messaging/effects.ts";
import { createInitialMachineState } from "../lib/messaging/machine.ts";
import { reconcile } from "../lib/messaging/reconcile.ts";
import { BUILD_DEADLINE_MS, REVOKE_ALL_COOLDOWN_MS } from "../lib/messaging/session-budgets.ts";
import type { XmtpLocalClient } from "../lib/messaging/ports.ts";
import {
  advanceAndSettle,
  answeredIntent,
  createControlledClock,
  createFakeNostrPolicyPort,
  createFakeWalletPort,
  createFakeXmtpPort,
  disposeAllOpenSessions,
  openSession,
  settleAsync,
  TEST_ADDRESS,
} from "./messaging-contract-harness.ts";
import { ROOT } from "./messaging-invariant-helpers.ts";

afterEach(async () => {
  await disposeAllOpenSessions();
});

function brandClient(id: number): XmtpLocalClient {
  return { __brand: "XmtpLocalClient", __id: id } as XmtpLocalClient;
}

function shouldCreateBody(source: string): string {
  const match = source.match(/function shouldCreate\([\s\S]*?\n\}/);
  assert.ok(match, "shouldCreate missing");
  return match![0];
}

describe("I2 mint authorisation is fail-closed", () => {
  // Blind spot: structural shouldCreate scan cannot see a future second create
  // path that bypasses shouldCreate entirely — behavioural create counts catch that.

  it("behavioural: unrecognised build_failed → zero creates", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(null) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "build_failed" }),
        createWithSigner: async () => {
          throw new Error("must not create");
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    for (let i = 0; i < 8; i += 1) await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("behavioural: opfs_lock → zero creates across enable retries", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: { buildLocal: async () => ({ ok: false, reason: "opfs_lock" }) },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    for (let i = 0; i < 8; i += 1) await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("behavioural: not_registered + enable → exactly one create", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: { buildLocal: async () => ({ ok: false, reason: "not_registered" }) },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 1);
    for (let i = 0; i < 5; i += 1) await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 1);
  });

  it("behavioural: one enable → at most one create when create fails", async () => {
    const clock = createControlledClock();
    let creates = 0;
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(null) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
        createWithSigner: async () => {
          creates += 1;
          return { ok: false, reason: "build_failed" };
        },
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    for (let i = 0; i < 12; i += 1) await settleAsync(clock);
    assert.equal(creates, 1);
    assert.equal(xmtp.calls.createWithSigner, 1);
  });

  it("structural: shouldCreate authorises only unregistered or resetChain create", () => {
    const body = shouldCreateBody(
      fs.readFileSync(path.join(ROOT, "lib/messaging/reconcile.ts"), "utf8"),
    );
    assert.ok(body.includes('registrationStatus === "unregistered"'));
    assert.ok(body.includes('resetChain === "create"'));
    assert.equal(body.includes("localBuildReason"), false);
    assert.equal(body.includes("opfs_lock"), false);
  });

  it("catches a constructed denylist-style shouldCreate violation", () => {
    const dirty = `
function shouldCreate(s) {
  if (s.localBuildReason === "opfs_lock") return false;
  if (s.registrationStatus === "unregistered") return true;
  return s.enableRequested;
}
`;
    const body = shouldCreateBody(dirty);
    assert.ok(body.includes("localBuildReason"));
    const clean = `
function shouldCreate(s) {
  if (s.registrationStatus === "unregistered") return true;
  if (s.resetChain === "create") return true;
  return false;
}
`;
    const cleanBody = shouldCreateBody(clean);
    assert.equal(cleanBody.includes("localBuildReason"), false);
    assert.ok(cleanBody.includes('resetChain === "create"'));
  });

  it("structural: create effect consumes enable before createWithSigner", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/effects.ts"), "utf8");
    const createBlock = text.match(
      /if \(plan\.effect === "create"\) \{[\s\S]*?return;\n    \}/,
    );
    assert.ok(createBlock);
    const block = createBlock![0];
    const enableIdx = block.indexOf('type: "enable_cleared"');
    const createIdx = block.indexOf("createWithSigner");
    assert.ok(enableIdx > 0 && createIdx > enableIdx);
  });
});

describe("I2 preserve-current revoke consumes mint authorisation", () => {
  // Blind spot: a create stage that survives others-revoke looks idle while a
  // client exists, then remints when the client is lost without a generation bump.

  it("behavioural: others-revoke success clears resetChain and creates zero times", async () => {
    const clock = createControlledClock();
    const fakeClient = brandClient(1);
    const xmtp = createFakeXmtpPort({
      buildLocal: async () => ({ ok: true, client: fakeClient }),
      revokeOtherInstallations: async () => ({ ok: true }),
      createWithSigner: async () => ({ ok: true, client: brandClient(2) }),
    });
    const nostr = createFakeNostrPolicyPort({
      readIntent: async () => answeredIntent(true),
      publishIntent: async () => ({ ok: true }),
    });
    const wallet = createFakeWalletPort();
    const cache = createInMemoryMessagingCache();
    const runner = createEffectsRunner({
      address: TEST_ADDRESS,
      ports: { xmtp, nostr, wallet },
      clock,
      cache,
      onChange: () => {},
    });
    runner.requestLocalClient();
    runner.start();
    await settleAsync(clock);
    assert.equal(runner.getState().localClient, fakeClient);
    assert.equal(xmtp.calls.createWithSigner, 0);

    runner.dispatch({ type: "resetIdentity" });
    await settleAsync(clock);

    assert.equal(runner.getState().resetChain, null);
    assert.equal(xmtp.calls.revokeOtherInstallations, 1);
    assert.equal(xmtp.calls.createWithSigner, 0);
    assert.equal(runner.getState().localClient, fakeClient);
    runner.dispose();
    await settleAsync(clock);
  });

  it("behavioural: after others-revoke, losing client without address change → zero creates", async () => {
    const clock = createControlledClock();
    const fakeClient = brandClient(1);
    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => answeredIntent(true),
        publishIntent: async () => ({ ok: true }),
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        revokeOtherInstallations: async () => ({ ok: true }),
        createWithSigner: async () => ({ ok: true, client: brandClient(2) }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "resetIdentity" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);

    // Same generation, no address change: client gone, cleared chain must not mint.
    const lostClientState = {
      ...createInitialMachineState(TEST_ADDRESS),
      intent: true as const,
      intentLoaded: true,
      intentKnown: true,
      registrationStatus: "registered" as const,
      localClient: null,
      resetChain: null,
      clientDemand: 1,
      generation: 1,
    };
    const plan = reconcile({
      state: lostClientState,
      nowMs: clock.nowMs(),
      moduleReady: true,
    });
    assert.notEqual(plan.kind === "run" && plan.effect === "create", true);
    for (let i = 0; i < 8; i += 1) await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("behavioural: dangling create stage after client loss would remint (hazard fixture)", () => {
    const dangling = {
      ...createInitialMachineState(TEST_ADDRESS),
      intent: true as const,
      intentLoaded: true,
      intentKnown: true,
      registrationStatus: "registered" as const,
      localClient: null,
      resetChain: "create" as const,
      clientDemand: 1,
    };
    const plan = reconcile({
      state: dangling,
      nowMs: 0,
      moduleReady: true,
    });
    assert.equal(plan.kind, "run");
    if (plan.kind === "run") assert.equal(plan.effect, "create");
  });

  it("behavioural: full revoke still creates once, intent false first, cooldown honoured", async () => {
    const clock = createControlledClock(1_000);
    const fakeClient = brandClient(1);
    const publishLog: boolean[] = [];
    let creates = 0;
    const { clearRevokeAllAt } = await import("../lib/messaging/adapters/cache-adapter.ts");
    const { getMessagingXmtpEnv } = await import("../lib/messaging/xmtp-env.ts");
    const env = getMessagingXmtpEnv();
    clearRevokeAllAt(env, TEST_ADDRESS);

    const { session, xmtp } = openSession(clock, {
      nostr: {
        readIntent: async () => answeredIntent(true),
        publishIntent: async (_a, enabled) => {
          publishLog.push(enabled);
          return { ok: true };
        },
      },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: fakeClient }),
        revokeAllInstallations: async () => ({ ok: true }),
        createWithSigner: async () => {
          creates += 1;
          return { ok: true, client: brandClient(creates + 1) };
        },
      },
    });
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    const createsBefore = xmtp.calls.createWithSigner;

    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 1);
    assert.ok(publishLog.length >= 1);
    assert.equal(publishLog[0], false);
    assert.equal(xmtp.calls.createWithSigner, createsBefore + 1);
    assert.equal(creates, 1);
    assert.equal(session.getSnapshot().state, "active");

    // Cooldown (marked by successful revoke) blocks a second full revoke.
    const createsAtCooldown = xmtp.calls.createWithSigner;
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 1);
    assert.equal(xmtp.calls.createWithSigner, createsAtCooldown);

    clock.advance(REVOKE_ALL_COOLDOWN_MS);
    session.dispatch({ type: "revokeAllInstallations" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.revokeAllInstallations, 2);
    clearRevokeAllAt(env, TEST_ADDRESS);
  });

  it("behavioural: preserve-current with no current installation still refuses", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(null) },
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
    assert.equal(xmtp.calls.createWithSigner, 1);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "needs_signature");
    if (snap.state === "needs_signature") assert.equal(snap.reason, "installation_limit");
  });
});

// Keep serialisation behavioural proof colocated with mint (I3 overlap) — see lifecycle for I3 primary.
describe("I2 companion: late-ok orphan after timeout is closed", () => {
  it("behavioural: late ok client after build timeout is closed", async () => {
    const clock = createControlledClock();
    let releaseBuild: { fn: ((result: { ok: true; client: XmtpLocalClient }) => void) | null } =
      { fn: null };
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () =>
          new Promise<{ ok: true; client: XmtpLocalClient }>((resolve) => {
            releaseBuild.fn = resolve;
          }),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    assert.equal(session.getSnapshot().state, "error");
    const closesBefore = xmtp.calls.closeLocal;
    releaseBuild.fn?.({ ok: true, client: brandClient(99) });
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal > closesBefore);
  });
});
