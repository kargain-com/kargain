import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Modules that publish after a merge-base read — must not use querySync. */
const PUBLISH_PATH_OWNERS = [
  path.join(ROOT, "lib/nostr/app-event-store.ts"),
  path.join(ROOT, "lib/nostr/favorites.ts"),
  path.join(ROOT, "lib/nostr/merge-kind0-content.ts"),
  path.join(ROOT, "lib/nostr/profile.ts"),
  path.join(ROOT, "lib/nostr/notification-state.ts"),
  path.join(ROOT, "lib/nostr/messaging-intent.ts"),
] as const;

/**
 * Exact allowlist of remaining read-only querySync callers (legacy display /
 * NWC / comments). The attested-profile resolver no longer uses querySync —
 * it reads through fetchRelayCoverage. A new publisher must not join this list.
 */
const KNOWN_QUERY_SYNC_READ_ONLY = [
  "lib/nostr/listing-offers.ts",
  "lib/nostr/nwc/nwc-client.ts",
  "hooks/use-nostr-notifications-sub.ts",
  "components/marketplace/nostr-comments-section.tsx",
] as const;

const QUERY_SYNC_CALL = /\.querySync\s*\(/;
const ENSURE_RELAY_CALL = /\.ensureRelay\s*\(/;
const FETCH_RELAY_COVERAGE = /fetchRelayCoverage/;
const EXPECT_EXISTING = /expectExisting/;
const IS_MERGE_BASE_UNAVAILABLE = /isMergeBaseUnavailable/;

function resolveImport(fromFile: string, spec: string): string | null {
  let resolved = spec;
  if (spec.startsWith("@/")) {
    resolved = path.join(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    resolved = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  if (!resolved.endsWith(".ts") && !resolved.endsWith(".tsx")) {
    if (fs.existsSync(resolved + ".ts")) return resolved + ".ts";
    if (fs.existsSync(resolved + ".tsx")) return resolved + ".tsx";
    return null;
  }
  return resolved;
}

/** Follow local imports from entry files; collect reachable source paths. */
function reachableFrom(entryRelPaths: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entryRelPaths.map((rel) => path.join(ROOT, rel));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    if (!file.startsWith(ROOT)) continue;
    if (!fs.existsSync(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const next = resolveImport(file, match[1]!);
      if (!next) continue;
      if (!next.includes(`${path.sep}lib${path.sep}`) && !next.includes(`${path.sep}hooks${path.sep}`)) {
        continue;
      }
      queue.push(next);
    }
  }
  return seen;
}

describe("nostr querySync write policy", () => {
  it("forbids querySync on publish-path owner modules", () => {
    const violations: string[] = [];
    for (const file of PUBLISH_PATH_OWNERS) {
      const text = fs.readFileSync(file, "utf8");
      if (QUERY_SYNC_CALL.test(text)) {
        violations.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(violations, []);
  });

  it("coverage reader uses ensureRelay via fetchRelayCoverage", () => {
    const text = fs.readFileSync(PUBLISH_PATH_OWNERS[0], "utf8");
    assert.ok(
      ENSURE_RELAY_CALL.test(text),
      "app-event-store.ts must call ensureRelay for per-relay coverage",
    );
    assert.ok(
      FETCH_RELAY_COVERAGE.test(text),
      "app-event-store.ts must export fetchRelayCoverage as the sole coverage owner",
    );
  });

  it("kind 0 merge-base read consumes fetchRelayCoverage", () => {
    const text = fs.readFileSync(PUBLISH_PATH_OWNERS[2], "utf8");
    assert.ok(
      FETCH_RELAY_COVERAGE.test(text),
      "merge-kind0-content must call fetchRelayCoverage",
    );
    assert.equal(QUERY_SYNC_CALL.test(text), false);
    assert.equal(IS_MERGE_BASE_UNAVAILABLE.test(text), false);
  });

  it("profile publish serializes and has no expectExisting heuristic", () => {
    const profile = fs.readFileSync(PUBLISH_PATH_OWNERS[3], "utf8");
    assert.equal(EXPECT_EXISTING.test(profile), false);
    assert.equal(IS_MERGE_BASE_UNAVAILABLE.test(profile), false);
    assert.ok(
      profile.includes("answeredRelays"),
      "profile publish must pass answeredRelays to publishSignedEvent",
    );
    assert.ok(
      profile.includes("runSerializedPubkeyWrite"),
      "kind:0 publish must serialize per pubkey",
    );
    assert.equal(
      profile.includes("publishNostrProfileWithPrivateKey"),
      false,
      "dual-read inner helper must be deleted",
    );
  });

  it("favorites LWW publish consumes answeredRelays", () => {
    const favorites = fs.readFileSync(PUBLISH_PATH_OWNERS[1], "utf8");
    assert.ok(
      favorites.includes("mergeReadLwwState"),
      "favorites must consume mergeReadLwwState status shape",
    );
    assert.ok(
      favorites.includes("answeredRelays"),
      "favorites must pass answeredRelays into publishLwwElementSet",
    );
    assert.equal(QUERY_SYNC_CALL.test(favorites), false);
  });

  it("kind 30078 notification-state uses fetchRelayCoverage and answeredRelays", () => {
    const text = fs.readFileSync(PUBLISH_PATH_OWNERS[4], "utf8");
    assert.ok(
      FETCH_RELAY_COVERAGE.test(text),
      "notification-state must call fetchRelayCoverage",
    );
    assert.ok(
      text.includes("runSerializedPubkeyWrite"),
      "notification-state save must serialize per pubkey",
    );
    assert.ok(
      text.includes("answeredRelays"),
      "notification-state publish must pass answeredRelays from coverage",
    );
    assert.equal(QUERY_SYNC_CALL.test(text), false);
  });

  it("messaging-intent owns coverage read and kind:0 write — not on read-only allowlist", () => {
    const text = fs.readFileSync(PUBLISH_PATH_OWNERS[5], "utf8");
    assert.ok(
      text.includes("fetchLatestKind0RawByAuthor"),
      "messaging-intent must read via coverage merge-base helper",
    );
    assert.ok(
      text.includes("publishNostrProfile"),
      "messaging-intent must write via sole kind:0 writer",
    );
    assert.equal(QUERY_SYNC_CALL.test(text), false);
    assert.equal(
      text.includes("resolveAttestedProfile"),
      false,
      "flag read must not go through resolveAttestedProfile",
    );
    assert.ok(
      !KNOWN_QUERY_SYNC_READ_ONLY.includes("lib/nostr/messaging-intent.ts"),
      "messaging-intent must not be classified as read-only querySync",
    );
  });

  it("notification hook folds remote into prev, not captured local", () => {
    const hook = fs.readFileSync(
      path.join(ROOT, "hooks/use-notification-state.tsx"),
      "utf8",
    );
    assert.ok(
      hook.includes("setState((prev) => mergeNotificationStates(prev, remote.state))"),
      "remote merge must fold into current prev via functional update",
    );
    assert.equal(
      /mergeNotificationStates\(\s*local\s*,/.test(hook),
      false,
      "must not merge against effect-captured local",
    );
    assert.equal(
      hook.includes("answeredRelaysRef"),
      false,
      "must not cache answered relays across mounts",
    );
  });

  it("documents the exact read-only querySync allowlist (legacy callers)", () => {
    assert.deepEqual([...KNOWN_QUERY_SYNC_READ_ONLY], [
      "lib/nostr/listing-offers.ts",
      "lib/nostr/nwc/nwc-client.ts",
      "hooks/use-nostr-notifications-sub.ts",
      "components/marketplace/nostr-comments-section.tsx",
    ]);
    for (const rel of KNOWN_QUERY_SYNC_READ_ONLY) {
      const full = path.join(ROOT, rel);
      assert.ok(fs.existsSync(full), `missing read-only caller ${rel}`);
      const text = fs.readFileSync(full, "utf8");
      assert.ok(
        QUERY_SYNC_CALL.test(text),
        `${rel} should still own a querySync call (read-only)`,
      );
    }
  });

  it("attested-profile resolver uses coverage + skew — not querySync", () => {
    const resolver = path.join(ROOT, "lib/nostr/resolve-attested-profile.ts");
    const text = fs.readFileSync(resolver, "utf8");
    assert.equal(QUERY_SYNC_CALL.test(text), false);
    assert.ok(FETCH_RELAY_COVERAGE.test(text));
    assert.ok(
      text.includes("ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS"),
      "skew bound must be a named export (not a comment)",
    );
    assert.ok(
      text.includes("isCreatedAtWithinReadSkew"),
      "skew helper must be applied on the read path",
    );
    assert.equal(
      text.includes("MAX_PROFILE_BATCH_LIMIT"),
      false,
      "shared batch limit must be deleted",
    );
  });

  it("ethereum identity-tag filters stay inside the attested-profile resolver", () => {
    const violations: string[] = [];
    const scanRoots = [
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
      path.join(ROOT, "components"),
    ];
    const allow = new Set([
      path.join(ROOT, "lib/nostr/resolve-attested-profile.ts"),
      path.join(ROOT, "lib/nostr/listing-offers.ts"),
    ]);
    function walk(dir: string) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
          if (name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (allow.has(full)) continue;
        const text = fs.readFileSync(full, "utf8");
        // NIP-39 ethereum identity tags only — listing-offers uses passport #i.
        if (/#i["']?\s*:/.test(text) && /ethereum:/.test(text)) {
          violations.push(path.relative(ROOT, full));
        }
      }
    }
    for (const root of scanRoots) walk(root);
    assert.deepEqual(violations, []);
  });

  it("skew bound is enforced by a test import (not comments alone)", () => {
    const testFile = path.join(ROOT, "test/resolve-attested-profile.test.ts");
    const text = fs.readFileSync(testFile, "utf8");
    assert.ok(
      text.includes("ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS"),
      "removing the skew export must fail the suite",
    );
    assert.ok(text.includes("isCreatedAtWithinReadSkew"));
    assert.ok(text.includes("preP5bEclipseOraclePick"));
  });

  it("messaging intent read path cannot reach wall-clock querySync transitively", () => {
    const entries = [
      "lib/nostr/messaging-intent.ts",
      "lib/messaging/adapters/nostr-adapter.ts",
    ];
    const reachable = reachableFrom(entries);
    const violations: string[] = [];
    for (const file of reachable) {
      const rel = path.relative(ROOT, file);
      const text = fs.readFileSync(file, "utf8");
      if (QUERY_SYNC_CALL.test(text)) {
        violations.push(rel);
      }
    }
    assert.deepEqual(
      violations,
      [],
      "intent path must not reach querySync (resolver is coverage-only)",
    );
    const coverageOwners = [...reachable].map((f) => path.relative(ROOT, f));
    assert.ok(
      coverageOwners.includes("lib/nostr/merge-kind0-content.ts"),
      "intent read must reach fetchLatestKind0RawByAuthor / coverage",
    );
    assert.ok(
      coverageOwners.some((r) => r.includes("app-event-store")),
      "intent read must reach fetchRelayCoverage owner",
    );
    const intentSrc = fs.readFileSync(
      path.join(ROOT, "lib/nostr/messaging-intent.ts"),
      "utf8",
    );
    assert.equal(intentSrc.includes("resolveAttestedProfile("), false);
    const adapterSrc = fs.readFileSync(
      path.join(ROOT, "lib/messaging/adapters/nostr-adapter.ts"),
      "utf8",
    );
    assert.equal(adapterSrc.includes("resolveAttestedProfile"), false);
  });
});
