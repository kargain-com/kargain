import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { shouldIdleWarmXmtp } from "../lib/messaging/snapshot-ui.ts";

/**
 * P4 — session path must not reach the registration probe (survives indirection).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SESSION_CORE = [
  "lib/messaging/effects.ts",
  "lib/messaging/reconcile.ts",
  "lib/messaging/machine.ts",
  "lib/messaging/session-store.ts",
  "lib/messaging/session-registry.ts",
].map((p) => path.join(ROOT, p));

const PORTS = path.join(ROOT, "lib/messaging/ports.ts");
const ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
const CONTACT = path.join(ROOT, "lib/messaging/contact-peer.ts");
const SETTINGS = path.join(ROOT, "components/profile/messaging-settings-section.tsx");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("messaging session probe deletion policy", () => {
  it("XmtpPort type must not declare probeRegistration", () => {
    const text = fs.readFileSync(PORTS, "utf8");
    const portBlock = text.match(/export type XmtpPort\s*=\s*\{([\s\S]*?)\n\};/);
    assert.ok(portBlock, "XmtpPort type missing");
    assert.doesNotMatch(portBlock[1]!, /\bprobeRegistration\b/);
    assert.doesNotMatch(text, /export type ProbeRegistrationResult/);
    assert.doesNotMatch(
      text,
      /export type ReconcilingOp\s*=\s*[\s\S]*?"probe"/,
    );
  });

  it("session core must not reference probeRegistration or probePeerRegistration", () => {
    const violations: string[] = [];
    for (const file of SESSION_CORE) {
      const text = stripComments(fs.readFileSync(file, "utf8"));
      if (/\bprobeRegistration\b/.test(text)) {
        violations.push(`${path.relative(ROOT, file)}: probeRegistration`);
      }
      if (/\bprobePeerRegistration\b/.test(text)) {
        violations.push(`${path.relative(ROOT, file)}: probePeerRegistration`);
      }
      if (/effect:\s*"probe"|op:\s*"probe"|"probe"\s*\|/.test(text)) {
        violations.push(`${path.relative(ROOT, file)}: probe op string`);
      }
    }
    assert.deepEqual(violations, []);
  });

  it("probePeerRegistration may appear only in xmtp-adapter and contact-peer", () => {
    const allowed = new Set([ADAPTER, CONTACT]);
    const violations: string[] = [];
    const dirs = [
      path.join(ROOT, "lib/messaging"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
    ];
    for (const dir of dirs) {
      for (const file of listTs(dir)) {
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("probePeerRegistration")) continue;
        if (allowed.has(file)) continue;
        violations.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(violations, []);
  });

  it("createXmtpAdapter return object must not list probeRegistration", () => {
    const text = stripComments(fs.readFileSync(ADAPTER, "utf8"));
    const factory = text.match(
      /export function createXmtpAdapter\s*\([^)]*\)\s*:\s*XmtpPort\s*\{([\s\S]*?)\n\}/,
    );
    assert.ok(factory, "createXmtpAdapter missing");
    const body = factory[1]!;
    // Method on the returned port object — not the peer helper export above.
    assert.doesNotMatch(body, /\basync\s+probeRegistration\s*\(/);
    assert.doesNotMatch(body, /\bprobeRegistration\s*:/);
  });

  it("settings section must not raise client demand", () => {
    const text = stripComments(fs.readFileSync(SETTINGS, "utf8"));
    assert.doesNotMatch(text, /useRequestLocalMessagingClient/);
    assert.doesNotMatch(text, /requestLocalClient/);
  });
});

describe("shouldIdleWarmXmtp", () => {
  it("fires only when reachable and no client", () => {
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: true, hasClient: false }), true);
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: true, hasClient: true }), false);
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: false, hasClient: false }), false);
    assert.equal(shouldIdleWarmXmtp({ publiclyReachable: false, hasClient: true }), false);
  });
});

function listTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
