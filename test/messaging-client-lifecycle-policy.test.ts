import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * XMTP Client acquisition/release ownership (P2 / RC-16).
 * SDK Client.build / Client.create / .close may only live in the adapter.
 * Effects must call closeLocal on every abandon path (including stale discards).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
];

const ADAPTER = path.join(ROOT, "lib/messaging/adapters/xmtp-adapter.ts");
const EFFECTS = path.join(ROOT, "lib/messaging/effects.ts");

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

describe("messaging client lifecycle policy", () => {
  it("bans Client.create / Client.build / Client.close outside xmtp-adapter", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === ADAPTER) continue;
        const text = stripComments(fs.readFileSync(file, "utf8"));
        if (/\bClient\.create\s*\(/.test(text)) {
          violations.push(`${path.relative(ROOT, file)}: Client.create`);
        }
        if (/\bClient\.build\s*\(/.test(text)) {
          violations.push(`${path.relative(ROOT, file)}: Client.build`);
        }
        // Instance close on SDK clients — allow stream.end elsewhere.
        if (/\.close\s*\(\s*\)/.test(text) && /@xmtp\/client|XmtpSdkClient|unbrandClient/.test(text)) {
          violations.push(`${path.relative(ROOT, file)}: .close() near XMTP types`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("effects abandons via closeLocal on dispose, address change, and stale build/create", () => {
    const text = fs.readFileSync(EFFECTS, "utf8");
    assert.match(text, /function abandonOwnedClient/);
    assert.match(text, /dispose\s*\(\s*\)\s*\{[\s\S]*abandonOwnedClient/);
    assert.match(
      text,
      /onAddressChange\s*\([^)]*\)\s*\{[\s\S]*abandonOwnedClient/,
    );
    // Address change must not inline a second deferred-close path.
    assert.doesNotMatch(
      text,
      /onAddressChange\s*\([^)]*\)\s*\{[\s\S]*clock\.sleep\(0\)\.then\(\s*\(\)\s*=>\s*\{\s*ports\.xmtp\.closeLocal/,
    );
    // Stale build: isStale then close orphan via closeOrphanBuildResult
    assert.match(
      text,
      /case "build":[\s\S]*if \(isStale\(opGeneration\)\) \{\s*closeOrphanBuildResult\(result\)/,
    );
    // Timeout path closes late-ok clients
    assert.ok(text.includes("closeOrphanBuildResult"));
    assert.match(
      text,
      /raced\.kind === "timeout"[\s\S]*closeOrphanBuildResult|void work\.then/,
    );
    // Stale create: isStale then closeLocal on ok client
    assert.match(
      text,
      /createWithSigner[\s\S]*if \(isStale\(opGeneration\)\) \{\s*if \(result\.ok\) ports\.xmtp\.closeLocal/,
    );
  });

  it("ports declare closeLocal, ensureModule, and ensureDurableStorage; active may carry storageEvictable", () => {
    const ports = fs.readFileSync(path.join(ROOT, "lib/messaging/ports.ts"), "utf8");
    assert.match(ports, /closeLocal\s*\(\s*client:\s*XmtpLocalClient\s*\)\s*:\s*void/);
    assert.match(ports, /ensureModule/);
    assert.match(ports, /isModuleReady/);
    assert.match(ports, /ensureDurableStorage/);
    assert.match(ports, /storageEvictable\?:\s*true/);
  });
});
