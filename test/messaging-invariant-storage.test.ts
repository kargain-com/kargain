/**
 * I4 — Browser storage under lib/messaging has one owner: cache-adapter.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isMessagingStorageAvailable,
  MESSAGING_MEMO_TTL_MS,
} from "../lib/messaging/adapters/cache-adapter.ts";
import { WALLET_CLIENT_POLL_MS, WALLET_CLIENT_WAIT_MS } from "../lib/messaging/adapters/wallet-adapter.ts";
import { PEER_REGISTRATION_DEADLINE_MS } from "../lib/messaging/contact-peer.ts";
import {
  BUILD_DEADLINE_MS,
  RECONCILING_HINT_MS,
  REVOKE_ALL_COOLDOWN_MS,
} from "../lib/messaging/session-budgets.ts";
import {
  CACHE_ADAPTER,
  ROOT,
  browserStorageViolations,
  listTsFiles,
  stripComments,
} from "./messaging-invariant-helpers.ts";

describe("I4 browser storage has one owner", () => {
  // Blind spot: does not cover sessionStorage/localStorage under components/
  // or hooks/ (e.g. catch-up dismiss key) — only lib/messaging.

  it("structural: only cache-adapter mentions localStorage or sessionStorage under lib/messaging", () => {
    const violations: string[] = [];
    for (const file of listTsFiles(path.join(ROOT, "lib/messaging"))) {
      if (file === CACHE_ADAPTER) continue;
      for (const hit of browserStorageViolations(fs.readFileSync(file, "utf8"))) {
        violations.push(`${path.relative(ROOT, file)}: ${hit}`);
      }
    }
    assert.deepEqual(violations, []);
    assert.equal(typeof isMessagingStorageAvailable, "function");
    const cache = fs.readFileSync(CACHE_ADAPTER, "utf8");
    assert.ok(cache.includes("messaging:compose-draft:"));
    assert.ok(cache.includes("isMessagingStorageAvailable"));
  });

  it("catches a constructed sessionStorage write outside cache-adapter", () => {
    const dirty = `
export function setComposeDraft(id, text) {
  sessionStorage.setItem("messaging:compose-draft:" + id, text);
}
`;
    assert.deepEqual(browserStorageViolations(dirty), ["sessionStorage"]);
    const clean = `
import { writeComposeDraft } from "./adapters/cache-adapter";
export function setComposeDraft(id, text) { writeComposeDraft(id, text); }
`;
    assert.deepEqual(browserStorageViolations(clean), []);
  });

  it("compose-draft domain delegates persistence", () => {
    const draft = fs.readFileSync(path.join(ROOT, "lib/messaging/compose-draft.ts"), "utf8");
    assert.equal(/\bsessionStorage\b/.test(draft), false);
    assert.ok(draft.includes("writeComposeDraft"));
    assert.ok(draft.includes("peekStoredComposeDraft"));
    assert.ok(draft.includes("clearStoredComposeDraft"));
  });

  it("session-store asks cache-adapter for storage availability", () => {
    const text = stripComments(
      fs.readFileSync(path.join(ROOT, "lib/messaging/session-store.ts"), "utf8"),
    );
    assert.ok(text.includes("isMessagingStorageAvailable"));
    assert.equal(text.includes("localStorage"), false);
  });

  it("pins historical budget values (owners outside ports)", () => {
    assert.equal(RECONCILING_HINT_MS, 5_000);
    assert.equal(BUILD_DEADLINE_MS, 10_000);
    assert.equal(REVOKE_ALL_COOLDOWN_MS, 24 * 60 * 60 * 1000);
    assert.equal(PEER_REGISTRATION_DEADLINE_MS, 5_000);
    assert.equal(WALLET_CLIENT_WAIT_MS, 3_000);
    assert.equal(WALLET_CLIENT_POLL_MS, 100);
    assert.equal(MESSAGING_MEMO_TTL_MS, 30 * 60 * 1000);
  });
});
