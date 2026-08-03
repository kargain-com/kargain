/**
 * Peer registration probe: module readiness outside the abort budget;
 * incomplete probe → unknown (never not_registered).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  __testGetXmtpLoadInvocationCount,
  isXmtpModuleReady,
} from "../lib/messaging/adapters/xmtp-adapter.ts";
import { peerReachabilityMessage, resolvePeerReachability } from "../lib/messaging/can-message-peer.ts";
import { checkXmtpReachable } from "../lib/messaging/contact-peer.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
const CONTACT = path.join(ROOT, "lib/messaging/contact-peer.ts");

describe("peer registration probe outcomes", () => {
  it("module not ready → unknown without starting a load", async () => {
    assert.equal(isXmtpModuleReady(), false);
    const before = __testGetXmtpLoadInvocationCount();
    const result = await checkXmtpReachable(
      "0x0000000000000000000000000000000000000001",
    );
    assert.equal(result.status, "unknown");
    assert.equal(__testGetXmtpLoadInvocationCount(), before);
  });

  it("unknown copy asserts nothing about peer registration", () => {
    const copy = peerReachabilityMessage("unknown") ?? "";
    assert.match(copy, /could not check/i);
    assert.doesNotMatch(copy, /not enabled/i);
    assert.doesNotMatch(copy, /not accepting/i);
  });

  it("browse reachability does not start a module load", async () => {
    const before = __testGetXmtpLoadInvocationCount();
    await resolvePeerReachability(
      "0x0000000000000000000000000000000000000001",
      { messagesEnabled: true },
    );
    assert.equal(__testGetXmtpLoadInvocationCount(), before);
  });
});

describe("peer probe source contracts", () => {
  it("contactPeer establishes readiness before the timed probe", () => {
    const text = fs.readFileSync(CONTACT, "utf8");
    const ensureIdx = text.indexOf("await ensureXmtpModuleReady()");
    const probeIdx = text.indexOf("await checkXmtpReachable(");
    assert.ok(ensureIdx > 0);
    assert.ok(probeIdx > ensureIdx);
  });

  it("probePeerRegistration assumes ready (ensureXmtpModule, not loadXmtp)", () => {
    const text = fs.readFileSync(ADAPTER, "utf8");
    const match = text.match(
      /export async function probePeerRegistration\([\s\S]*?\n\}/,
    );
    assert.ok(match);
    assert.equal(match![0].includes("loadXmtp"), false);
    assert.equal(match![0].includes("ensureModuleLoaded"), false);
    assert.ok(match![0].includes("ensureXmtpModule()"));
  });

  it("checkXmtpReachable returns unknown on catch, not false", () => {
    const text = fs.readFileSync(CONTACT, "utf8");
    const match = text.match(
      /export async function checkXmtpReachable\([\s\S]*?\n\}/,
    );
    assert.ok(match);
    assert.ok(match![0].includes('status: "unknown"'));
    assert.doesNotMatch(match![0], /return false/);
    assert.doesNotMatch(match![0], /loadXmtp|ensureModuleLoaded|ensureXmtpModuleReady/);
  });
});
