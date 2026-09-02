import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

/**
 * Modules allowed to call `derivePassportPresence` (§4.21 ownership).
 * Everything under app/components/hooks outside this list is a violation.
 */
export const PASSPORT_PRESENCE_DERIVER_OWNERS = [
  "lib/passport/presence.ts",
  "lib/passport/action-surface.ts",
  "lib/passport/bridge-surface.ts",
  "hooks/use-passport-presence.ts",
] as const;

const SCAN_ROOTS = ["app", "components", "hooks"] as const;

const DERIVER_IMPORT =
  /derivePassportPresence\s*[,}]|derivePassportPresence\s+from|from\s+["'][^"']*passport\/presence["'][^;]*derivePassportPresence/;

const DERIVER_CALL = /\bderivePassportPresence\s*\(/;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function isOwnerPath(rel: string): boolean {
  return (PASSPORT_PRESENCE_DERIVER_OWNERS as readonly string[]).includes(rel);
}

function findDeriverViolations(): { path: string; reason: string }[] {
  const violations: { path: string; reason: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (isOwnerPath(rel)) continue;
      const src = readFileSync(file, "utf8");
      if (DERIVER_CALL.test(src) || DERIVER_IMPORT.test(src)) {
        // Narrow: only flag if the symbol appears as an import or call.
        if (
          /\bderivePassportPresence\b/.test(src) &&
          (src.includes("derivePassportPresence(") ||
            /import\s*\{[^}]*\bderivePassportPresence\b/.test(src))
        ) {
          violations.push({
            path: rel,
            reason: "calls or imports derivePassportPresence outside owners",
          });
        }
      }
    }
  }
  return violations;
}

/** Exported for constructed-violation tests — same predicate as the scan. */
export function presenceDeriverViolationInSource(
  relPath: string,
  source: string,
): boolean {
  if (isOwnerPath(relPath.replace(/\\/g, "/"))) return false;
  return (
    /\bderivePassportPresence\b/.test(source) &&
    (source.includes("derivePassportPresence(") ||
      /import\s*\{[^}]*\bderivePassportPresence\b/.test(source))
  );
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

  it("no app/components/hooks file outside owners calls the deriver", () => {
    const violations = findDeriverViolations();
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
      join(ROOT, "components/passport/passport-bridge-panel.tsx"),
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

  it("owners may call the deriver", () => {
    for (const owner of PASSPORT_PRESENCE_DERIVER_OWNERS) {
      if (owner === "lib/passport/presence.ts") continue;
      const src = readFileSync(join(ROOT, owner), "utf8");
      assert.match(src, /derivePassportPresence/, owner);
      assert.equal(
        presenceDeriverViolationInSource(owner, src),
        false,
        owner,
      );
    }
  });
});
