/**
 * I3 — Every acquired SDK handle has a release path; acquisition serialises behind release.
 * I12 — Client.create/build/close and raw syncAll/conversations.sync only in the adapter.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { BUILD_DEADLINE_MS } from "../lib/messaging/session-budgets.ts";
import type { XmtpLocalClient } from "../lib/messaging/ports.ts";
import {
  advanceAndSettle,
  answeredIntent,
  createControlledClock,
  disposeAllOpenSessions,
  openSession,
  settleAsync,
} from "./messaging-contract-harness.ts";
import {
  ROOT,
  XMTP_ADAPTER,
  clientFactoryViolations,
  rawSyncViolations,
  scanTree,
} from "./messaging-invariant-helpers.ts";

afterEach(async () => {
  await disposeAllOpenSessions();
});

function brandClient(id: number): XmtpLocalClient {
  return { __brand: "XmtpLocalClient", __id: id } as XmtpLocalClient;
}

describe("I3 release path and acquisition serialisation", () => {
  // Blind spot: cannot prove every future stream handle registers if opened
  // outside openInboxDeliveryStreams — stream registry scan is adapter-local.

  it("behavioural: acquisition waits for whenLocalIdle before build", async () => {
    const clock = createControlledClock();
    let buildStarted = 0;
    let releaseGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        whenLocalIdle: async () => {
          await gate;
        },
        buildLocal: async () => {
          buildStarted += 1;
          return { ok: true, client: brandClient(1) };
        },
      },
    });
    await settleAsync(clock);
    assert.equal(buildStarted, 0);
    releaseGate?.();
    await settleAsync(clock);
    assert.ok(buildStarted >= 1);
    assert.equal(session.getSnapshot().state, "active");
    assert.ok(xmtp.calls.whenLocalIdle >= 1);
  });

  it("behavioural: idle wait does not consume BUILD_DEADLINE_MS", async () => {
    const clock = createControlledClock();
    let buildStartedAt: number | null = null;
    let releaseGate: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        whenLocalIdle: async () => {
          await gate;
        },
        buildLocal: async () => {
          buildStartedAt = clock.nowMs();
          return { ok: true, client: brandClient(2) };
        },
      },
    });
    await settleAsync(clock);
    const idleStarted = clock.nowMs();
    await advanceAndSettle(clock, BUILD_DEADLINE_MS + 2_000);
    assert.equal(buildStartedAt, null);
    releaseGate?.();
    await settleAsync(clock);
    assert.ok(buildStartedAt != null);
    assert.ok((buildStartedAt as number) >= idleStarted + BUILD_DEADLINE_MS);
  });

  it("structural: effects abandon via closeLocal on dispose, address change, stale paths", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/effects.ts"), "utf8");
    assert.match(text, /function abandonOwnedClient/);
    assert.match(text, /dispose\s*\(\s*\)\s*\{[\s\S]*abandonOwnedClient/);
    assert.match(text, /onAddressChange\s*\([^)]*\)\s*\{[\s\S]*abandonOwnedClient/);
    assert.match(text, /closeOrphanBuildResult/);
    assert.match(
      text,
      /plan\.effect === "build"[\s\S]*whenLocalIdle[\s\S]*BUILD_DEADLINE_MS[\s\S]*runWithDeadline/,
    );
  });

  it("structural: adapter streams register and closeLocal ends them", () => {
    const text = fs.readFileSync(XMTP_ADAPTER, "utf8");
    assert.ok(text.includes("registerClientStream"));
    assert.ok(text.includes("endAllStreamsForClient"));
    assert.match(
      text,
      /closeLocalClient[\s\S]*endAllStreamsForClient|endAllStreamsForClient[\s\S]*closeLocalClient/,
    );
  });

  it("catches a constructed missing-abandon dispose violation", () => {
    const dirty = `
function dispose() {
  ports.clock.clear();
}
`;
    assert.doesNotMatch(dirty, /abandonOwnedClient/);
    const clean = `
function dispose() {
  abandonOwnedClient("dispose");
}
`;
    assert.match(clean, /abandonOwnedClient/);
  });

  it("ports declare awaitable closeLocal and whenLocalIdle", () => {
    const ports = fs.readFileSync(path.join(ROOT, "lib/messaging/ports.ts"), "utf8");
    assert.match(ports, /closeLocal\(client: XmtpLocalClient\):\s*Promise<void>/);
    assert.match(ports, /whenLocalIdle\(\):\s*Promise<void>/);
  });
});

describe("I12 adapter choke-point for Client factory and raw sync", () => {
  // Blind spot: `.close()` heuristic only flags files that also mention XMTP
  // types — a bare close on an untyped handle is invisible.

  it("structural: Client.create/build absent outside adapter", () => {
    const dirs = [
      path.join(ROOT, "app"),
      path.join(ROOT, "components"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "lib"),
    ];
    const found = scanTree(dirs, (src) => clientFactoryViolations(src), {
      exclude: (file) => file === XMTP_ADAPTER,
    });
    assert.deepEqual(found, []);
  });

  it("catches a constructed Client.create outside adapter", () => {
    assert.deepEqual(clientFactoryViolations(`await Client.create(signer)`), [
      "Client.create",
    ]);
    assert.deepEqual(clientFactoryViolations(`await createWithSigner(ports)`), []);
  });

  it("structural: raw syncAll / conversations.sync stay in adapter", () => {
    const dirs = [
      path.join(ROOT, "app"),
      path.join(ROOT, "components"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "lib/messaging"),
    ];
    const found = scanTree(dirs, (src) => rawSyncViolations(src), {
      exclude: (file) => file === XMTP_ADAPTER,
    });
    assert.deepEqual(found, []);
  });

  it("catches a constructed raw syncAll outside adapter", () => {
    assert.deepEqual(rawSyncViolations(`await client.conversations.syncAll()`), [
      "syncAll",
    ]);
    assert.deepEqual(
      rawSyncViolations(`await syncConversationsAndMessages(client)`),
      [],
    );
  });
});
