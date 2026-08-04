import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * P8 delivery policy: no periodic conversation sync; streams open/close via
 * adapter ownership; last-seen and window-event sync coupling deleted.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
] as const;

const ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
const PROVIDER = path.join(
  ROOT,
  "components/providers/xmtp-conversations-provider.tsx",
);
const CACHE = path.join(ROOT, "lib/messaging/adapters/cache-adapter.ts");

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

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("messaging delivery policy (P8)", () => {
  it("deletes last-seen module and window-event sync vocabulary", () => {
    assert.equal(fs.existsSync(path.join(ROOT, "lib/messaging/last-seen.ts")), false);
    assert.equal(
      fs.existsSync(path.join(ROOT, "lib/messaging/conversations-sync.ts")),
      false,
    );
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        const text = stripComments(fs.readFileSync(file, "utf8"));
        if (text.includes("xmtp:conversations-changed")) {
          violations.push(`${path.relative(ROOT, file)}: conversations-changed`);
        }
        if (text.includes("xmtp:lastseen-updated")) {
          violations.push(`${path.relative(ROOT, file)}: lastseen-updated`);
        }
        if (text.includes("getLastSeen") || text.includes("setLastSeen")) {
          violations.push(`${path.relative(ROOT, file)}: lastSeen helpers`);
        }
        if (text.includes("CONVERSATIONS_SYNC_INTERVAL_MS")) {
          violations.push(`${path.relative(ROOT, file)}: interval constant`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("provider has no setInterval and no focus/visibility sync drivers", () => {
    const text = stripComments(fs.readFileSync(PROVIDER, "utf8"));
    assert.equal(text.includes("setInterval"), false);
    assert.equal(text.includes("visibilitychange"), false);
    assert.equal(text.includes('addEventListener("focus"'), false);
    assert.ok(text.includes("openInboxDeliveryStreams"));
    assert.ok(text.includes("markConversationRead"));
  });

  it("adapter owns stream open/end and closeLocal ends streams", () => {
    const text = fs.readFileSync(ADAPTER, "utf8");
    assert.ok(text.includes("openInboxDeliveryStreams"));
    assert.ok(text.includes("endAllStreamsForClient"));
    assert.ok(text.includes("getLiveInboxStreamCount"));
    assert.match(text, /closeLocalClient[\s\S]*endAllStreamsForClient|endAllStreamsForClient[\s\S]*closeLocalClient/);
    assert.ok(text.includes("closeLocal(client)"));
    assert.ok(text.includes("closeLocalClient"));
    assert.ok(text.includes("endAllStreamsForClient"));
    assert.ok(text.includes("streamDms"));
    assert.ok(text.includes("streamAllDmMessages"));
    // Consent omitted — no Allowed-only filter on the open call.
    assert.equal(/streamAllDmMessages\(\s*\{[^}]*consentStates/.test(text), false);
  });

  it("messaging library does not mention localStorage outside cache-adapter", () => {
    const messagingLib = path.join(ROOT, "lib/messaging");
    const violations: string[] = [];
    for (const file of listTsFiles(messagingLib)) {
      const rel = path.relative(ROOT, file);
      if (rel === "lib/messaging/adapters/cache-adapter.ts") continue;
      const text = stripComments(fs.readFileSync(file, "utf8"));
      if (/\blocalStorage\b/.test(text)) {
        violations.push(rel);
      }
    }
    assert.deepEqual(violations, []);
    const cache = fs.readFileSync(CACHE, "utf8");
    assert.ok(cache.includes("xmtp:lastseen:"));
    assert.ok(cache.includes("isMessagingStorageAvailable"));
  });

  it("stream acquisition has matching release path (handle.end + closeLocal)", () => {
    const text = fs.readFileSync(ADAPTER, "utf8");
    assert.ok(text.includes("registerClientStream"));
    assert.ok(text.includes("unregisterClientStream"));
    assert.match(
      text,
      /return\s*\{\s*async\s+end\(\)/,
    );
  });
});
