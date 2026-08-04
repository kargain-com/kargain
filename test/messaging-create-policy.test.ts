/**
 * Mint authorisation is fail-closed: only a completed not_registered build
 * (or resetChain create) authorises create. Teardown completion is observed.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  await disposeAllOpenSessions();
});

function brandClient(id: number): XmtpLocalClient {
  return { __brand: "XmtpLocalClient", __id: id } as XmtpLocalClient;
}

describe("mint authorisation — positive answer only", () => {
  it("unrecognised build_failed → zero creates", async () => {
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
    assert.equal(session.getSnapshot().state, "needs_signature");
  });

  it("opfs_lock build → zero creates", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "opfs_lock" }),
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

  it("completed not_registered + enable → exactly one create", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "not_registered" }),
      },
    });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 0);
    session.dispatch({ type: "enable" });
    await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 1);
    assert.equal(session.getSnapshot().state, "active");
    for (let i = 0; i < 5; i += 1) await settleAsync(clock);
    assert.equal(xmtp.calls.createWithSigner, 1);
  });

  it("reconcile loops after build failure never create", async () => {
    const clock = createControlledClock();
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: false, reason: "build_failed" }),
      },
    });
    await settleAsync(clock);
    session.dispatch({ type: "enable" });
    for (let i = 0; i < 20; i += 1) {
      await settleAsync(clock);
      session.requestLocalClient();
      await settleAsync(clock);
    }
    assert.equal(xmtp.calls.createWithSigner, 0);
  });

  it("one enable → at most one create when create fails and loop re-enters", async () => {
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
});

describe("teardown serialisation", () => {
  it("acquisition waits for whenLocalIdle before build", async () => {
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
    assert.equal(xmtp.calls.whenLocalIdle >= 1, true);
    assert.equal(buildStarted, 0);
    releaseGate?.();
    await settleAsync(clock);
    assert.ok(buildStarted >= 1);
    assert.equal(session.getSnapshot().state, "active");
  });

  it("build while release outstanding does not consume BUILD_DEADLINE_MS", async () => {
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
    assert.equal(buildStartedAt, null);
    await advanceAndSettle(clock, BUILD_DEADLINE_MS + 2_000);
    assert.equal(buildStartedAt, null, "build must not start while idle blocked");
    releaseGate?.();
    await settleAsync(clock);
    assert.ok(buildStartedAt != null);
    assert.ok(
      (buildStartedAt as number) >= idleStarted + BUILD_DEADLINE_MS,
      "deadline must not run during idle wait",
    );
  });

  it("closeLocal completion is observed by whenLocalIdle before next acquire", async () => {
    const clock = createControlledClock();
    let closeReleased: (() => void) | null = null;
    const { xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () => ({ ok: true, client: brandClient(21) }),
        closeLocal: async () => {
          await new Promise<void>((resolve) => {
            closeReleased = resolve;
          });
        },
      },
    });
    await settleAsync(clock);

    void xmtp.closeLocal(brandClient(99));
    let idleDone = false;
    const idleWait = xmtp.whenLocalIdle().then(() => {
      idleDone = true;
    });
    await settleAsync(clock);
    assert.equal(idleDone, false);
    closeReleased?.();
    await idleWait;
    assert.equal(idleDone, true);
  });
});

describe("create path policy", () => {
  it("shouldCreate authorises only unregistered or resetChain create", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "lib/messaging/reconcile.ts"),
      "utf8",
    );
    const match = text.match(/function shouldCreate\([\s\S]*?\n\}/);
    assert.ok(match);
    const body = match![0];
    assert.ok(body.includes('registrationStatus === "unregistered"'));
    assert.ok(body.includes('resetChain === "create"'));
    assert.equal(body.includes("localBuildReason"), false);
    assert.equal(body.includes("opfs_lock"), false);
  });

  it("create effect consumes enable and registration before createWithSigner", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "lib/messaging/effects.ts"),
      "utf8",
    );
    const createBlock = text.match(
      /if \(plan\.effect === "create"\) \{[\s\S]*?return;\n    \}/,
    );
    assert.ok(createBlock);
    const block = createBlock![0];
    const enableIdx = block.indexOf('type: "enable_cleared"');
    const regIdx = block.indexOf('status: "unknown"');
    const createIdx = block.indexOf("createWithSigner");
    assert.ok(enableIdx > 0 && regIdx > 0 && createIdx > regIdx);
    assert.ok(enableIdx < createIdx);
  });

  it("ports expose awaitable closeLocal and whenLocalIdle", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "lib/messaging/ports.ts"),
      "utf8",
    );
    assert.match(text, /whenLocalIdle\(\):\s*Promise<void>/);
    assert.match(text, /closeLocal\(client: XmtpLocalClient\):\s*Promise<void>/);
  });
});
