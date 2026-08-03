import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P3 session ownership + lazy SDK structural policy.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROVIDER = path.join(
  ROOT,
  "components/providers/messaging-session-provider.tsx",
);
const HOOK = path.join(ROOT, "hooks/use-messaging-session.ts");
const REGISTRY = path.join(ROOT, "lib/messaging/session-registry.ts");
const CAN_MESSAGE = path.join(ROOT, "lib/messaging/can-message-peer.ts");
const PEER_HOOK = path.join(ROOT, "hooks/use-peer-messaging-reachability.ts");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("messaging session ownership policy", () => {
  it("creates sessions during provider render, not inside useEffect bodies", () => {
    const provider = stripComments(fs.readFileSync(PROVIDER, "utf8"));
    const hook = stripComments(fs.readFileSync(HOOK, "utf8"));

    assert.match(provider, /registry\.acquire/);
    assert.match(provider, /createMessagingSession/);

    // No createMessagingSession / registry.acquire inside a useEffect callback body.
    const effectBodies = [
      ...provider.matchAll(/useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,/g),
      ...hook.matchAll(/useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,/g),
    ];
    for (const match of effectBodies) {
      const body = match[1] ?? "";
      assert.doesNotMatch(body, /createMessagingSession/);
      assert.doesNotMatch(body, /registry\.acquire/);
    }

    assert.match(hook, /useContext\(MessagingSessionContext\)/);
    assert.doesNotMatch(hook, /createMessagingSession/);
    assert.doesNotMatch(hook, /new Map/);
  });

  it("bans module-scope session Maps outside the registry", () => {
    const violations: string[] = [];
    const scanDirs = [
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "lib/messaging"),
    ];
    for (const dir of scanDirs) {
      for (const file of listTsFiles(dir)) {
        if (file === REGISTRY) continue;
        const text = stripComments(fs.readFileSync(file, "utf8"));
        if (/const\s+sessions\s*=\s*new\s+Map/.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
        if (/Map<\s*string\s*,\s*[^>]*MessagingSession/.test(text)) {
          violations.push(`${path.relative(ROOT, file)}: MessagingSession Map`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("deletes syncWalletAddress; address change uses changeAddress / registry", () => {
    const violations: string[] = [];
    const self = path.join(ROOT, "test/messaging-session-ownership-policy.test.ts");
    for (const dir of [
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
      path.join(ROOT, "test"),
    ]) {
      for (const file of listTsFiles(dir)) {
        if (file === self) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("syncWalletAddress")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("browse peer reachability must not import xmtp-adapter or probePeerRegistration", () => {
    for (const file of [CAN_MESSAGE, PEER_HOOK]) {
      const text = stripComments(fs.readFileSync(file, "utf8"));
      assert.doesNotMatch(text, /xmtp-adapter/);
      assert.doesNotMatch(text, /probePeerRegistration/);
      assert.doesNotMatch(text, /checkXmtpReachable/);
    }
  });
});
