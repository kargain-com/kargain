import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { WALLET_CLIENT_POLL_MS, WALLET_CLIENT_WAIT_MS } from "../lib/messaging/adapters/wallet-adapter.ts";
import {
  isMessagingStorageAvailable,
  MESSAGING_MEMO_TTL_MS,
} from "../lib/messaging/adapters/cache-adapter.ts";
import { PEER_REGISTRATION_DEADLINE_MS } from "../lib/messaging/contact-peer.ts";
import {
  BUILD_DEADLINE_MS,
  RECONCILING_HINT_MS,
  REVOKE_ALL_COOLDOWN_MS,
} from "../lib/messaging/session-budgets.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("messaging wall-clock budgets (value pins)", () => {
  it("pins historical session / peer / wallet / memo values", () => {
    assert.equal(RECONCILING_HINT_MS, 5_000);
    assert.equal(BUILD_DEADLINE_MS, 10_000);
    assert.equal(REVOKE_ALL_COOLDOWN_MS, 24 * 60 * 60 * 1000);
    assert.equal(PEER_REGISTRATION_DEADLINE_MS, 5_000);
    assert.equal(WALLET_CLIENT_WAIT_MS, 3_000);
    assert.equal(WALLET_CLIENT_POLL_MS, 100);
    assert.equal(MESSAGING_MEMO_TTL_MS, 30 * 60 * 1000);
  });

  it("ports no longer exports session or peer wall-clock budgets", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/ports.ts"), "utf8");
    assert.equal(text.includes("PROBE_DEADLINE"), false);
    assert.equal(text.includes("BUILD_DEADLINE"), false);
    assert.equal(text.includes("RECONCILING_HINT"), false);
    assert.equal(text.includes("REVOKE_ALL_COOLDOWN"), false);
    assert.equal(/\bexport const \w*DEADLINE|\bexport const RECONCILING|\bexport const REVOKE_ALL/.test(text), false);
  });

  it("contact-peer owns peer registration deadline", () => {
    const text = fs.readFileSync(path.join(ROOT, "lib/messaging/contact-peer.ts"), "utf8");
    assert.ok(text.includes("export const PEER_REGISTRATION_DEADLINE_MS"));
    assert.ok(text.includes("PEER_REGISTRATION_DEADLINE_MS"));
    assert.equal(text.includes("PROBE_DEADLINE"), false);
    assert.equal(text.includes('from "./ports"'), false);
  });

  it("session-store asks cache-adapter for storage availability", () => {
    const text = stripComments(
      fs.readFileSync(path.join(ROOT, "lib/messaging/session-store.ts"), "utf8"),
    );
    assert.ok(text.includes("isMessagingStorageAvailable"));
    assert.equal(text.includes("localStorage"), false);
  });
});

describe("messaging localStorage choke-point", () => {
  it("only cache-adapter may mention localStorage under lib/messaging", () => {
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
    assert.equal(typeof isMessagingStorageAvailable, "function");
  });
});
