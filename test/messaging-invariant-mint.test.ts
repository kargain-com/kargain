/**
 * I2 — Only a completed negative registration answer authorises minting.
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

// Keep serialisation behavioural proof colocated with mint (I3 overlap) — see lifecycle for I3 primary.
describe("I2 companion: late-ok orphan after timeout is closed", () => {
  it("behavioural: late ok client after build timeout is closed", async () => {
    const clock = createControlledClock();
    let releaseBuild: ((result: { ok: true; client: XmtpLocalClient }) => void) | null = null;
    const { session, xmtp } = openSession(clock, {
      nostr: { readIntent: async () => answeredIntent(true) },
      xmtp: {
        buildLocal: async () =>
          new Promise((resolve) => {
            releaseBuild = resolve;
          }),
      },
    });
    await advanceAndSettle(clock, BUILD_DEADLINE_MS);
    assert.equal(session.getSnapshot().state, "error");
    const closesBefore = xmtp.calls.closeLocal;
    releaseBuild?.({ ok: true, client: brandClient(99) });
    await settleAsync(clock);
    assert.ok(xmtp.calls.closeLocal > closesBefore);
  });
});
