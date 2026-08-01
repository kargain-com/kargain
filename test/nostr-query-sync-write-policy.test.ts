import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const LWW_OWNERS = [
  path.join(ROOT, "lib/nostr/app-event-store.ts"),
  path.join(ROOT, "lib/nostr/favorites.ts"),
] as const;

/**
 * Known non-LWW callers of querySync (kind 0 / 30078 RMW and read-only resolvers).
 * Deferred to separate tasks — must not appear inside LWW owners.
 */
const KNOWN_QUERY_SYNC_DEFERRED = [
  "lib/nostr/resolve-attested-profile.ts",
  "lib/nostr/listing-offers.ts",
  "lib/nostr/nwc/nwc-client.ts",
  "lib/nostr/merge-kind0-content.ts",
  "lib/nostr/notification-state.ts",
  "hooks/use-nostr-notifications-sub.ts",
  "components/marketplace/nostr-comments-section.tsx",
] as const;

const QUERY_SYNC_CALL = /\.querySync\s*\(/;
const ENSURE_RELAY_CALL = /\.ensureRelay\s*\(/;

describe("nostr querySync write policy (LWW)", () => {
  it("forbids querySync calls in LWW owner modules", () => {
    const violations: string[] = [];
    for (const file of LWW_OWNERS) {
      const text = fs.readFileSync(file, "utf8");
      if (QUERY_SYNC_CALL.test(text)) {
        violations.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(violations, []);
  });

  it("LWW coverage reader uses ensureRelay", () => {
    const text = fs.readFileSync(LWW_OWNERS[0], "utf8");
    assert.ok(
      ENSURE_RELAY_CALL.test(text),
      "app-event-store.ts must call ensureRelay for per-relay coverage",
    );
  });

  it("does not reintroduce favorites LWW publish beside the store owner", () => {
    const favorites = fs.readFileSync(LWW_OWNERS[1], "utf8");
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

  it("documents known deferred querySync callers outside LWW", () => {
    for (const rel of KNOWN_QUERY_SYNC_DEFERRED) {
      const full = path.join(ROOT, rel);
      assert.ok(fs.existsSync(full), `missing deferred caller ${rel}`);
      const text = fs.readFileSync(full, "utf8");
      assert.ok(
        QUERY_SYNC_CALL.test(text),
        `${rel} should still own a querySync call until its task`,
      );
    }
  });
});
