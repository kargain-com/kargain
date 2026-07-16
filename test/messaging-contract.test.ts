/**
 * Messaging R0 — executable behavioral contract.
 *
 * Every scenario is `it.todo` until R1 implements CreateMessagingSession.
 * Suite runs green and visibly incomplete. Canonical spec:
 * docs/research/messaging-rebuild.md
 */

import { describe, it } from "node:test";

import {
  BUILD_DEADLINE_MS,
  PROBE_DEADLINE_MS,
} from "../lib/messaging/ports.ts";

// Touch harness + deadline constants so the module graph is loadable in R0.
void PROBE_DEADLINE_MS;
void BUILD_DEADLINE_MS;

/** Mulberry32 — deterministic seeded PRNG for R1 property tests. */
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("messaging contract — scenarios", () => {
  it.todo(
    "cutover: intent enabled, network unregistered, no OPFS → needs_signature",
  );
  it.todo("july16: hung probe settles by PROBE_DEADLINE_MS → timeout");
  it.todo("july16: hung build settles by BUILD_DEADLINE_MS → timeout");
  it.todo("fresh: build succeeds → active without signature");
  it.todo("reload: silent restore succeeds → active");
  it.todo("reload: build fails → needs_signature reason=build_failed");
  it.todo(
    "enable while background build in flight → createWithSigner after settle without client",
  );
  it.todo("disable: publishIntent(false) before local teardown");
  it.todo("disable: publish failure → still active, reason=publish_failed");
  it.todo("second tab: OPFS lock → error/opfs_lock dedicated path, no crash loop");
  it.todo("address switch: stale-generation events discarded");
  it.todo(
    "installation_limit on create → reason + revoke→reset→create recovery",
  );
  it.todo("contract wallet → unsupported; commands rejected");
  it.todo("caches: expired/absent memos change latency only");
  it.todo("intent absent never enabled → disabled with next=enable");
  it.todo("create cancelled mid-signature → reason=create_cancelled");
  it.todo(
    "reload while intent disabled → must not create; stay disabled",
  );
});

describe("messaging contract — invariants", () => {
  it.todo("invariant: no state older than its deadline");
  it.todo("invariant: at most one session operation in flight");
  it.todo("invariant: only effects interpreter touches ports");
  it.todo(
    "invariant: every non-active/non-terminal snapshot exposes a concrete next command",
  );
});
