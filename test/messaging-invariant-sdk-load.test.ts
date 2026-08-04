/**
 * I1 — Module loading is never inside a wall-clock deadline or abort timer.
 * I13 — Browse peer reachability never starts an XMTP module load; incomplete
 *       probes classify as unknown, never as unregistered.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { BUILD_DEADLINE_MS } from "../lib/messaging/session-budgets.ts";
import type { BuildLocalResult, XmtpLocalClient } from "../lib/messaging/ports.ts";
import { peerReachabilityMessage, resolvePeerReachability } from "../lib/messaging/can-message-peer.ts";
import {
  __testGetXmtpLoadInvocationCount,
  isXmtpModuleReady,
} from "../lib/messaging/adapters/xmtp-adapter.ts";
import { checkXmtpReachable } from "../lib/messaging/contact-peer.ts";
import {
  advanceAndSettle,
  answeredIntent,
  createControlledClock,
  disposeAllOpenSessions,
  hangUntilAbort,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";
import {
  ROOT,
  XMTP_ADAPTER,
  wallClockLoaderViolations,
  walkMessagingLib,
} from "./messaging-invariant-helpers.ts";

afterEach(async () => {
  await disposeAllOpenSessions();
});

function brandClient(id: number): XmtpLocalClient {
  return { __brand: "XmtpLocalClient", __id: id } as XmtpLocalClient;
}

describe("I1 module load never inside a deadline", () => {
  // Blind spot: does not prove cross-file A-under-timer → B → ensureModuleLoaded
  // when B is a separate function; loadXmtp call-site count closes the import hole.

  it("behavioural: slow ensureModule past BUILD_DEADLINE_MS never times out as setup", async () => {
    const clock = createControlledClock();
    let resolveEnsure: (() => void) | null = null;
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        ensureModule: async (signal) => {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            resolveEnsure = () => resolve();
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        },
        buildLocal: async () => ({ ok: true, client: brandClient(1) }),
      },
    });
    await settleAsync(clock);
    await advanceAndSettle(clock, BUILD_DEADLINE_MS + 5_000);
    const mid = session.getSnapshot();
    assert.equal(mid.state === "error" && mid.reason === "timeout", false);
    resolveEnsure?.();
    await settleAsync(clock);
    assert.equal(session.getSnapshot().state, "active");
    assert.ok(xmtp.calls.buildLocal >= 1);
  });

  it("behavioural: post-ready hung build still times out at BUILD_DEADLINE_MS", async () => {
    const clock = createControlledClock();
    const { session } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: { buildLocal: async (_a, signal) => hangUntilAbort(signal) },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    const snap = session.getSnapshot();
    assert.equal(snap.state, "error");
    if (snap.state === "error") assert.equal(snap.reason, "timeout");
  });

  it("structural: live tree has no wall-clock abort body that reaches the loader", () => {
    const found: string[] = [];
    for (const file of walkMessagingLib()) {
      for (const name of wallClockLoaderViolations(fs.readFileSync(file, "utf8"))) {
        found.push(`${path.relative(ROOT, file)}:${name}`);
      }
    }
    assert.deepEqual(found, []);
  });

  it("catches a constructed deadline-around-loader violation", () => {
    const dirty = `
export async function checkXmtpReachable(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try { await loadXmtp(); } finally { clearTimeout(timeout); }
}
`;
    assert.deepEqual(wallClockLoaderViolations(dirty), ["checkXmtpReachable"]);
    const clean = `
export async function checkXmtpReachable(address) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try { await probePeerRegistration(address, controller.signal); }
  finally { clearTimeout(timeout); }
}
`;
    assert.deepEqual(wallClockLoaderViolations(clean), []);
  });

  it("structural: loadXmtp only from preloadXmtp and ensureModuleLoaded; sdk not deadlined", () => {
    const text = fs.readFileSync(XMTP_ADAPTER, "utf8");
    assert.equal([...text.matchAll(/\bloadXmtp\s*\(/g)].length, 3);
    assert.ok(/export function preloadXmtp[\s\S]{0,80}return loadXmtp\(\)/.test(text));
    assert.ok(/async function ensureModuleLoaded[\s\S]{0,200}loadXmtp\(\)/.test(text));
    const effects = fs.readFileSync(path.join(ROOT, "lib/messaging/effects.ts"), "utf8");
    assert.equal(/case "sdk":[\s\S]{0,400}runWithDeadline/.test(effects), false);
    assert.ok(/plan\.effect === "build"[\s\S]{0,800}runWithDeadline/.test(effects));
  });

  it("budget owners stay off ports (value pin)", () => {
    const ports = fs.readFileSync(path.join(ROOT, "lib/messaging/ports.ts"), "utf8");
    assert.equal(ports.includes("BUILD_DEADLINE"), false);
    assert.equal(ports.includes("PROBE_DEADLINE"), false);
  });
});

describe("I13 browse reachability never loads the module", () => {
  // Blind spot: cannot detect a future browse path that loads via dynamic
  // import() under an alias that never mentions xmtp-adapter by name.

  it("behavioural: probe when module not ready → unknown without load", async () => {
    assert.equal(isXmtpModuleReady(), false);
    const before = __testGetXmtpLoadInvocationCount();
    const result = await checkXmtpReachable(
      "0x0000000000000000000000000000000000000001",
    );
    assert.equal(result.status, "unknown");
    assert.equal(__testGetXmtpLoadInvocationCount(), before);
  });

  it("behavioural: browse reachability does not start a module load", async () => {
    const before = __testGetXmtpLoadInvocationCount();
    await resolvePeerReachability(
      "0x0000000000000000000000000000000000000001",
      { messagesEnabled: true },
    );
    assert.equal(__testGetXmtpLoadInvocationCount(), before);
  });

  it("structural: can-message-peer and peer hook never import adapter/probe", () => {
    for (const rel of [
      "lib/messaging/can-message-peer.ts",
      "hooks/use-peer-messaging-reachability.ts",
    ]) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.doesNotMatch(text, /xmtp-adapter/);
      assert.doesNotMatch(text, /probePeerRegistration/);
      assert.doesNotMatch(text, /checkXmtpReachable/);
    }
  });

  it("catches a constructed browse-path adapter import violation", () => {
    const dirty = `
import { probePeerRegistration } from "./adapters/xmtp-adapter";
export function canMessagePeer() { return probePeerRegistration("0x"); }
`;
    assert.match(dirty, /xmtp-adapter/);
    assert.match(dirty, /probePeerRegistration/);
    const clean = `
export function canMessagePeer() { return { reachable: false, reason: "unknown" }; }
`;
    assert.doesNotMatch(clean, /xmtp-adapter/);
  });

  it("unknown copy asserts nothing about registration", () => {
    const copy = peerReachabilityMessage("unknown") ?? "";
    assert.match(copy, /could not check/i);
    assert.doesNotMatch(copy, /not enabled/i);
  });
});
