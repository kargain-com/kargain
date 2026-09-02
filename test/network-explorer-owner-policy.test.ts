/**
 * S8-1 — explorer URL assembly lives only in network-explorer.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

const OWNER = "lib/web3/network-explorer.ts";
/** Registry may declare explorerBaseUrl literals; assembly stays in OWNER. */
const ALLOWLIST = new Set([
  OWNER,
  "lib/web3/commercial-active.ts",
]);

const SCAN_ROOTS = ["app", "components", "hooks", "lib"] as const;

const FORBIDDEN = [
  /blockExplorers/,
  /sepolia\.basescan\.org/,
  /`[^`]*\/address\/\$\{/,
  /`[^`]*\/tx\/\$\{/,
  /["'][^"']*\/address\/\$\{/,
  /["'][^"']*\/tx\/\$\{/,
] as const;

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

export function explorerOwnerViolationInSource(
  relPath: string,
  source: string,
): boolean {
  const norm = relPath.replace(/\\/g, "/");
  if (ALLOWLIST.has(norm)) return false;
  return FORBIDDEN.some((re) => re.test(source));
}

function findExplorerViolations(): { path: string; reason: string }[] {
  const violations: { path: string; reason: string }[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(src)) {
          violations.push({
            path: rel,
            reason: `matches ${re}`,
          });
          break;
        }
      }
    }
  }
  return violations;
}

describe("network explorer owner policy (S8-1)", () => {
  it("no product path assembles explorer URLs outside network-explorer", () => {
    const violations = findExplorerViolations();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.path}: ${v.reason}`).join("\n"),
    );
  });

  it("constructed wallet-button fixture is red", () => {
    const dirty = `
const explorer = getViemChain(id)?.blockExplorers?.default?.url ?? "https://sepolia.basescan.org";
const url = \`\${explorer}/address/\${addr}\`;
`;
    assert.equal(
      explorerOwnerViolationInSource("components/wallet-login-button.tsx", dirty),
      true,
    );
  });

  it("owner module itself is exempt", () => {
    const ownerSrc = readFileSync(join(ROOT, OWNER), "utf8");
    assert.equal(explorerOwnerViolationInSource(OWNER, ownerSrc), false);
  });

  it("product tree must not import the tests-only SVM fixture", () => {
    const ban = /fixtures\/commercial-svm-stack|commercial-svm-stack/;
    const hits: string[] = [];
    for (const root of ["app", "components", "hooks", "lib"] as const) {
      for (const file of walkTsFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file).replace(/\\/g, "/");
        const src = readFileSync(file, "utf8");
        if (ban.test(src)) hits.push(rel);
      }
    }
    assert.deepEqual(hits, []);
  });
});
