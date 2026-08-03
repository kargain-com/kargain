/**
 * Deterministic randomized simulation of the messaging session core.
 * Asserts four invariants after every step.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { SessionCommand, SessionSnapshot } from "../lib/messaging/ports.ts";
import { snapshotHasActionableNext } from "../lib/messaging/machine.ts";
import { createSeededRng } from "./messaging-rng.ts";
import {
  advanceAndSettle,
  createControlledClock,
  createFakeNostrPolicyPort,
  createFakeWalletPort,
  createFakeXmtpPort,
  disposeAllOpenSessions,
  hangUntilAbort,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";

afterEach(async () => {
  await disposeAllOpenSessions();
});

const SIMULATION_SEEDS = [1, 42, 1337, 9001, 0xdeadbeef, 8675309, 314159];
const STEPS_PER_SEED = 250;

const COMMANDS: SessionCommand[] = [
  { type: "enable" },
  { type: "disable" },
  { type: "resetIdentity" },
  { type: "revokeAllInstallations" },
  { type: "retry" },
  { type: "cancel" },
];

function assertDeadlineBound(snapshot: SessionSnapshot, nowMs: number): void {
  if (snapshot.state === "reconciling") {
    assert.ok(snapshot.deadlineMs >= nowMs, "deadline must not be in the past");
  }
}

function assertActionableNext(snapshot: SessionSnapshot): void {
  if (snapshot.state === "active" && !snapshot.next) return;
  if (snapshot.state === "disconnected" || snapshot.state === "unsupported") return;
  if (snapshot.state === "reconciling") return;
  assert.ok(snapshotHasActionableNext(snapshot), `snapshot lacks next: ${JSON.stringify(snapshot)}`);
}

type StepAction =
  | { kind: "advance"; ms: number }
  | { kind: "dispatch"; command: SessionCommand }
  | { kind: "switchAddress" };

function pickAction(rng: () => number): StepAction {
  const roll = rng();
  if (roll < 0.15) {
    const msChoices = [100, 500, 1000, 5000, 10000];
    return { kind: "advance", ms: msChoices[Math.floor(rng() * msChoices.length)] };
  }
  if (roll < 0.25) {
    return { kind: "switchAddress" };
  }
  return {
    kind: "dispatch",
    command: COMMANDS[Math.floor(rng() * COMMANDS.length)],
  };
}

describe("messaging simulation — seeded invariants", () => {
  for (const seed of SIMULATION_SEEDS) {
    it(`seed ${seed}: ${STEPS_PER_SEED} steps preserve invariants`, async () => {
      const rng = createSeededRng(seed);
      const clock = createControlledClock();
      const fakeClient = { __brand: "XmtpLocalClient" as const };

      let inFlight = 0;
      let maxInFlight = 0;
      let intent: boolean | null = null;
      let networkRegistered = false;
      let buildOk = true;
      let publishOk = true;
      let hangBuild = false;

      const xmtp = createFakeXmtpPort({
        buildLocal: async (_a, signal) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            if (hangBuild) return hangUntilAbort(signal);
            if (!networkRegistered) return { ok: false, reason: "not_registered" as const };
            if (!buildOk) return { ok: false, reason: "build_failed" as const };
            return { ok: true, client: fakeClient };
          } finally {
            inFlight -= 1;
          }
        },
        createWithSigner: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            networkRegistered = true;
            return { ok: true, client: fakeClient };
          } finally {
            inFlight -= 1;
          }
        },
        revokeOtherInstallations: async (_a, _s, current) =>
          current ? { ok: true } : { ok: false, reason: "no_current_installation" },
        revokeAllInstallations: async () => ({ ok: true }),
        readInstallations: async () => ({ installations: [], currentInstallationId: null }),
        closeLocal: () => {},
        ensureDurableStorage: async () => ({ durable: true }),
      });

      const nostr = createFakeNostrPolicyPort({
        readIntent: async () => ({ status: "answered", intent }),
        publishIntent: async (_a, enabled) => {
          if (!publishOk) return { ok: false, reason: "publish_failed" };
          if (enabled) intent = true;
          else intent = false;
          return { ok: true };
        },
      });

      const wallet = createFakeWalletPort();
      const { session, xmtp: sessionXmtp } = openSession(clock, {
        xmtp: {
          buildLocal: xmtp.buildLocal.bind(xmtp),
          createWithSigner: xmtp.createWithSigner.bind(xmtp),
          closeLocal: xmtp.closeLocal.bind(xmtp),
          ensureDurableStorage: xmtp.ensureDurableStorage.bind(xmtp),
          revokeOtherInstallations: xmtp.revokeOtherInstallations.bind(xmtp),
          revokeAllInstallations: xmtp.revokeAllInstallations.bind(xmtp),
          readInstallations: xmtp.readInstallations.bind(xmtp),
        },
        nostr: {
          readIntent: nostr.readIntent.bind(nostr),
          publishIntent: nostr.publishIntent.bind(nostr),
        },
        wallet,
      });

      await settleAsync(clock);

      for (let step = 0; step < STEPS_PER_SEED; step += 1) {
        // Randomly flip port behavior every few steps.
        if (rng() < 0.08) intent = rng() < 0.33 ? null : rng() < 0.5 ? false : true;
        if (rng() < 0.08) networkRegistered = rng() < 0.6;
        if (rng() < 0.05) buildOk = !buildOk;
        if (rng() < 0.05) publishOk = !publishOk;
        if (rng() < 0.03) hangBuild = !hangBuild;

        const action = pickAction(rng);
        if (action.kind === "advance") {
          await advanceAndSettle(clock, action.ms);
        } else if (action.kind === "switchAddress") {
          const hex = Math.floor(rng() * 0xffff)
            .toString(16)
            .padStart(40, "0");
          wallet.setAddress(`0x${hex}`);
          session.changeAddress(`0x${hex}`);
          session.requestLocalClient();
          await settleAsync(clock);
        } else {
          session.dispatch(action.command);
          await settleAsync(clock);
        }

        const snap = session.getSnapshot();
        assertDeadlineBound(snap, clock.nowMs());
        assert.ok(maxInFlight <= 1, `max in-flight ops ${maxInFlight} > 1 at step ${step}`);
        assertActionableNext(snap);
      }

      session.dispose();
      await settleAsync(clock);
      assert.equal(sessionXmtp.liveCount, 0, "dispose must close every acquired client");
    });
  }
});
