import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const COMPONENTS = path.join(ROOT, "components");
const HOOKS = path.join(ROOT, "hooks");

/** Sole owners of React Query invalidation after a synced write. */
const INVALIDATE_ALLOWLIST = new Set([
  path.join(HOOKS, "use-tx-sync.ts"),
]);

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsxFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("tx-sync write policy", () => {
  it("requires useTxSync in every component that calls writeContractAsync", () => {
    const missing: string[] = [];
    for (const file of listTsxFiles(COMPONENTS)) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("writeContractAsync(")) continue;
      if (!text.includes("useTxSync")) {
        missing.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(missing, []);
  });

  it("forbids panel/hook invalidateQueries outside useTxSync", () => {
    const violations: string[] = [];
    for (const dir of [COMPONENTS, HOOKS]) {
      for (const file of listTsxFiles(dir)) {
        if (INVALIDATE_ALLOWLIST.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("invalidateQueries(")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("does not resurrect auction post-tx dual-path symbols", () => {
    const banned = [/auctionChainQueryKey/, /invalidateAfterTx/];
    const hits: string[] = [];
    for (const dir of [COMPONENTS, HOOKS]) {
      for (const file of listTsxFiles(dir)) {
        const text = fs.readFileSync(file, "utf8");
        for (const re of banned) {
          if (re.test(text)) {
            hits.push(`${path.relative(ROOT, file)}: ${re.source}`);
          }
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});
