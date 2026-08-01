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
] as const;

/**
 * Exact allowlist of read-only querySync callers.
 * A new publisher must not join this list silently.
 */
const KNOWN_QUERY_SYNC_READ_ONLY = [
  "lib/nostr/resolve-attested-profile.ts",
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

  it("profile publish has no expectExisting / isMergeBaseUnavailable heuristic", () => {
    const profile = fs.readFileSync(PUBLISH_PATH_OWNERS[3], "utf8");
    assert.equal(EXPECT_EXISTING.test(profile), false);
    assert.equal(IS_MERGE_BASE_UNAVAILABLE.test(profile), false);
    assert.ok(
      profile.includes("answeredRelays"),
      "profile publish must pass answeredRelays to publishSignedEvent",
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

  it("documents the exact read-only querySync allowlist", () => {
    assert.deepEqual([...KNOWN_QUERY_SYNC_READ_ONLY], [
      "lib/nostr/resolve-attested-profile.ts",
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
});
