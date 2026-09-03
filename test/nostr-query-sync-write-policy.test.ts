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
  path.join(ROOT, "lib/nostr/publish-kind0-profile.ts"),
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
    const profile = fs.readFileSync(
      path.join(ROOT, "lib/nostr/profile.ts"),
      "utf8",
    );
    const kind0 = fs.readFileSync(
      path.join(ROOT, "lib/nostr/publish-kind0-profile.ts"),
      "utf8",
    );
    assert.equal(EXPECT_EXISTING.test(profile), false);
    assert.equal(IS_MERGE_BASE_UNAVAILABLE.test(profile), false);
    assert.ok(
      kind0.includes("answeredRelays"),
      "kind:0 core must pass answeredRelays to publishSignedEvent",
    );
    assert.ok(
      kind0.includes("runSerializedPubkeyWrite"),
      "kind:0 publish must serialize per pubkey",
    );
    assert.equal(
      profile.includes("publishNostrProfileWithPrivateKey"),
      false,
      "dual-read inner helper must be deleted",
    );
    assert.ok(
      profile.includes("publishKind0Profile"),
      "profile unlock entry must delegate to kind:0 core",
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
    const text = fs.readFileSync(
      path.join(ROOT, "lib/nostr/notification-state.ts"),
      "utf8",
    );
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
    const text = fs.readFileSync(
      path.join(ROOT, "lib/nostr/messaging-intent.ts"),
      "utf8",
    );
    assert.ok(
      text.includes("fetchLatestKind0RawByAuthor"),
      "messaging-intent must read via coverage merge-base helper",
    );
    assert.ok(
      text.includes("publishKind0Profile"),
      "messaging-intent must write via key-injected kind:0 core (no key-manager)",
    );
    assert.equal(text.includes("getOrCreateNostrKey"), false);
    assert.equal(QUERY_SYNC_CALL.test(text), false);
    assert.equal(
      text.includes("resolveAttestedProfile"),
      false,
      "flag read must not go through resolveAttestedProfile",
    );
    assert.ok(
      !([...KNOWN_QUERY_SYNC_READ_ONLY] as readonly string[]).includes(
        "lib/nostr/messaging-intent.ts",
      ),
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
    const resolver = fs.readFileSync(
      path.join(ROOT, "lib/nostr/resolve-attested-profile.ts"),
      "utf8",
    );
    assert.equal(
      resolver.includes("preP5bEclipseOraclePick"),
      false,
      "eclipse oracle must not live in the production choke point",
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, "test/pre-p5b-eclipse-oracle.ts")),
      "oracle helper must live under test/",
    );
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

  it("messaging path cannot reach key-manager transitively", () => {
    const entries = [
      "lib/messaging/adapters/nostr-adapter.ts",
      "lib/nostr/messaging-intent.ts",
      "lib/messaging/effects.ts",
    ];
    const reachable = reachableFrom(entries);
    const violations = [...reachable]
      .map((f) => path.relative(ROOT, f))
      .filter((rel) => rel === "lib/nostr/key-manager.ts" || rel.endsWith("/key-manager.ts"));
    assert.deepEqual(
      violations,
      [],
      "messaging unlock must go through NostrKeyProvider; adapter must not reach key-manager",
    );
    const adapterSrc = fs.readFileSync(
      path.join(ROOT, "lib/messaging/adapters/nostr-adapter.ts"),
      "utf8",
    );
    assert.equal(adapterSrc.includes("getOrCreateNostrKey"), false);
    assert.ok(adapterSrc.includes("obtainKey"));
  });
});

describe("I9 coverage reader feeds write decisions (P10)", () => {
  // Blind spot: cannot see a publisher that uses querySync via eval or a
  // dynamically imported module outside PUBLISH_PATH_OWNERS.

  it("catches a constructed querySync on a publish-path owner", () => {
    const dirty = `
export async function saveFavorites() {
  const events = await pool.querySync([{ kinds: [30000] }]);
  await publish(events);
}
`;
    assert.equal(QUERY_SYNC_CALL.test(dirty), true);
    const clean = `
export async function saveFavorites() {
  const coverage = await fetchRelayCoverage(filter);
  await publish(coverage.answeredRelays);
}
`;
    assert.equal(QUERY_SYNC_CALL.test(clean), false);
    assert.equal(FETCH_RELAY_COVERAGE.test(clean), true);
  });
});

describe("I10 attested-profile sole owner + skew bound (P10)", () => {
  // Blind spot: skew presence is textual — a renamed constant with the same
  // numeric literal would pass until resolve-attested-profile behavioural tests fail.

  it("catches a constructed ethereum identity-tag query outside the resolver", () => {
    const dirty = `
export async function lookupPeer(address) {
  return pool.querySync([{ "#i": ["ethereum:" + address] }]);
}
`;
    assert.ok(/#i["']?\s*:/.test(dirty) && /ethereum:/.test(dirty));
    const clean = `
export async function lookupPeer(address) {
  return resolveAttestedProfile(address);
}
`;
    assert.equal(/#i["']?\s*:/.test(clean) && /ethereum:/.test(clean), false);
  });

  it("catches removal of the skew export name", () => {
    const dirty = `
export function isCreatedAtWithinReadSkew(created, now) {
  return Math.abs(created - now) <= 3600;
}
`;
    assert.equal(dirty.includes("ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS"), false);
    const live = fs.readFileSync(
      path.join(ROOT, "lib/nostr/resolve-attested-profile.ts"),
      "utf8",
    );
    assert.ok(live.includes("ATTESTED_PROFILE_CREATED_AT_SKEW_SECONDS"));
  });
});

describe("I15 messaging identity owner (P10)", () => {
  // Blind spot: transitive reachability walk misses packages outside lib/hooks.

  it("catches a constructed getOrCreateNostrKey on the messaging adapter", () => {
    const dirty = `
export function createNostrPolicyAdapter(deps) {
  return {
    async obtainKey() {
      return getOrCreateNostrKey(deps.address);
    },
  };
}
`;
    assert.ok(dirty.includes("getOrCreateNostrKey"));
    const live = fs.readFileSync(
      path.join(ROOT, "lib/messaging/adapters/nostr-adapter.ts"),
      "utf8",
    );
    assert.equal(live.includes("getOrCreateNostrKey"), false);
    assert.ok(live.includes("obtainKey"));
  });
});
