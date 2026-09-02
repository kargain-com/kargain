/**
 * §4.21 — derivePassportPresence only in named owners.
 * Uses the sole product policy scanner (app|components|hooks|lib).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  POLICY_SCAN_ROOT,
  scanProductSources,
} from "./policy-scan-helpers.ts";

/**
 * Modules allowed to call `derivePassportPresence` (§4.21 ownership).
 */
export const PASSPORT_PRESENCE_DERIVER_OWNERS = [
  "lib/passport/presence.ts",
  "lib/passport/action-surface.ts",
  "lib/passport/bridge-surface.ts",
  "hooks/use-passport-presence.ts",
] as const;

/** Exported for constructed-violation tests — same predicate as the scan. */
export function presenceDeriverViolationInSource(
  relPath: string,
  source: string,
): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if ((PASSPORT_PRESENCE_DERIVER_OWNERS as readonly string[]).includes(norm)) {
    return false;
  }
  return (
    /\bderivePassportPresence\b/.test(source) &&
    (source.includes("derivePassportPresence(") ||
      /import\s*\{[^}]*\bderivePassportPresence\b/.test(source))
  );
}

function presencePredicate(rel: string, source: string): string | false {
  if (!presenceDeriverViolationInSource(rel, source)) return false;
  return "calls or imports derivePassportPresence outside owners";
}

describe("passport presence deriver ownership", () => {
  it("owners list is exactly the four §4.21 derivation sites", () => {
    assert.deepEqual([...PASSPORT_PRESENCE_DERIVER_OWNERS].sort(), [
      "hooks/use-passport-presence.ts",
      "lib/passport/action-surface.ts",
      "lib/passport/bridge-surface.ts",
      "lib/passport/presence.ts",
    ]);
  });

  it("no product file outside owners calls the deriver", () => {
    const violations = scanProductSources(presencePredicate, {
      owners: PASSPORT_PRESENCE_DERIVER_OWNERS,
    });
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed violation: panel deriving location itself turns red", () => {
    const dirty = `
import { derivePassportPresence } from "@/lib/passport/presence";
export function PassportBridgePanel() {
  const locationPresence = derivePassportPresence({
    viewChainId: 84532,
    custodyLocked: false,
  });
  return locationPresence.status;
}
`;
    assert.equal(
      presenceDeriverViolationInSource(
        "components/passport/passport-bridge-panel.tsx",
        dirty,
      ),
      true,
    );
    const clean = readFileSync(
      join(POLICY_SCAN_ROOT, "components/passport/passport-bridge-panel.tsx"),
      "utf8",
    );
    assert.equal(
      presenceDeriverViolationInSource(
        "components/passport/passport-bridge-panel.tsx",
        clean,
      ),
      false,
    );
  });

  it("constructed dirty lib/ non-owner (old scope miss) is red, live tree green", () => {
    const dirty = `
import { derivePassportPresence } from "@/lib/passport/presence";
export function invent() {
  return derivePassportPresence({ viewChainId: 1, custodyLocked: false });
}
`;
    assert.equal(
      presenceDeriverViolationInSource("lib/marketplace/invent-presence.ts", dirty),
      true,
    );
    const live = scanProductSources(presencePredicate, {
      owners: PASSPORT_PRESENCE_DERIVER_OWNERS,
    });
    assert.deepEqual(live, []);
  });

  it("owners may call the deriver", () => {
    for (const owner of PASSPORT_PRESENCE_DERIVER_OWNERS) {
      if (owner === "lib/passport/presence.ts") continue;
      const src = readFileSync(join(POLICY_SCAN_ROOT, owner), "utf8");
      assert.match(src, /derivePassportPresence/, owner);
      assert.equal(
        presenceDeriverViolationInSource(owner, src),
        false,
        owner,
      );
    }
  });
});
