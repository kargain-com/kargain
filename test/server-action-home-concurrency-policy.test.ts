/**
 * B5 — home wallet-gated Server Action POSTs are not serialized.
 *
 * After connect, layout-mounted hooks fire independent React Query
 * queryFns (each a Server Action). Watchlist already Promise.all's two.
 * Phase 3 therefore stays cache tags — not Route-Handler-first for queue.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const WALLET_HOME_HOOKS = [
  "hooks/use-pending-claims.ts",
  "hooks/use-ponder-notifications.ts",
  "hooks/use-owned-passport-token-ids.ts",
  "hooks/use-watchlist-notifications.ts",
] as const;

describe("B5 home Server Action concurrency", () => {
  it("wallet-gated home hooks use independent useQuery (overlap, not a queue)", () => {
    for (const rel of WALLET_HOME_HOOKS) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(text, /useQuery\(/, `${rel} must use useQuery`);
      assert.match(
        text,
        /enabled:\s*isConnected/,
        `${rel} must gate on isConnected`,
      );
      assert.doesNotMatch(
        text,
        /serial(ize|Queue)|actionQueue|mutex|p-limit|oneAtATime/i,
        `${rel} must not introduce a Server Action serial queue`,
      );
    }
  });

  it("watchlist batch fires two Server Actions concurrently", () => {
    const text = fs.readFileSync(
      path.join(ROOT, "hooks/use-watchlist-notifications.ts"),
      "utf8",
    );
    assert.match(text, /Promise\.all\(\[/);
    assert.match(text, /fetchPassportBatch/);
    assert.match(text, /fetchListingBatch/);
  });
});
