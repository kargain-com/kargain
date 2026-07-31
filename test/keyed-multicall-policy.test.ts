import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
] as const;

/** Sole owner of wagmi `useReadContracts`. */
const OWNER = path.join(ROOT, "lib/web3/keyed-multicall.ts");

/**
 * Match `useReadContracts` imported from `wagmi` (single- or multi-line).
 * Does not match comments that merely mention the symbol in prose without an import.
 */
const USE_READ_CONTRACTS_FROM_WAGMI =
  /import\s*(?:type\s+)?(?:\{[^}]*\buseReadContracts\b[^}]*\}|\*\s+as\s+\w+)\s*from\s*["']wagmi["']/;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("keyed multicall policy", () => {
  it("allows useReadContracts import only in lib/web3/keyed-multicall.ts", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === OWNER) continue;
        const text = fs.readFileSync(file, "utf8");
        if (USE_READ_CONTRACTS_FROM_WAGMI.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("owning module imports useReadContracts from wagmi", () => {
    const text = fs.readFileSync(OWNER, "utf8");
    assert.ok(
      USE_READ_CONTRACTS_FROM_WAGMI.test(text),
      "keyed-multicall.ts must import useReadContracts from wagmi",
    );
  });
});
