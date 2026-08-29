/**
 * Forbid tests from mutating repo `deployments/` (gitignored live-deploy records).
 * Isolation must use `KARGAIN_DEPLOYMENTS_DIR` → empty temp dir, never rename/unlink/write.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");

const MUTATION_FN =
  /\b(?:fs(?:Promises)?\.)?(?:promises\.)?(?:rename|unlink|rm|rmdir|writeFile)(?:Sync)?\s*\(/;

const DEPLOYMENTS_PATH =
  /["'`][^"'`]*deployments\/[^"'`]*["'`]|`[^`]*deployments\/[^`]*`|join\s*\([^)]*["']deployments/;

function listTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("deployments mutation policy", () => {
  it("forbids rename/unlink/rm/rmdir/writeFile against deployments/ under test/", () => {
    const violations: string[] = [];
    for (const file of listTestFiles(TEST_DIR)) {
      // This file documents the ban with the regex patterns themselves.
      if (file.endsWith(`${path.sep}deployments-mutation-policy.test.ts`)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (!MUTATION_FN.test(text)) continue;
      if (!DEPLOYMENTS_PATH.test(text)) continue;
      violations.push(path.relative(ROOT, file));
    }
    assert.deepEqual(
      violations,
      [],
      `Tests must not mutate deployments/ (use KARGAIN_DEPLOYMENTS_DIR):\n${violations.join("\n")}`,
    );
  });
});
