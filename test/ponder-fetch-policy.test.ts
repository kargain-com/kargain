import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app/actions"),
  path.join(ROOT, "lib/passport"),
  path.join(ROOT, "lib/verifier"),
] as const;

/** Content-addressed blobs may keep TTL — not mutable Ponder state. */
const ALLOWLIST = new Set([
  path.join(ROOT, "lib/passport/fetch-arweave-metadata.ts"),
]);

const FORBIDDEN = [
  { name: "revalidate: 30", re: /revalidate:\s*30/ },
  { name: "fresh?:", re: /fresh\?:/ },
  { name: 'cache: "no-store" inline', re: /cache:\s*"no-store"/ },
] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("ponder fetch policy", () => {
  it("forbids dual-path and inline Data Cache on mutable Ponder callers", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (ALLOWLIST.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const rule of FORBIDDEN) {
          if (rule.re.test(text)) {
            violations.push(`${path.relative(ROOT, file)}: ${rule.name}`);
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("routes scanned Ponder HTTP through ponderFetch / ponderBaseUrl", () => {
    const missing: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (ALLOWLIST.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (!text.includes("PONDER_SQL_API_URL") && !/\$\{ponderBaseUrl\(\)\}/.test(text) && !text.includes("ponderFetch(")) {
          // Files without Ponder I/O are fine
          continue;
        }
        if (text.includes("PONDER_SQL_API_URL")) {
          missing.push(`${path.relative(ROOT, file)}: still uses PONDER_SQL_API_URL`);
        }
        // If the file calls into Ponder paths via template/base, require helper import
        if (
          /\/(listings|auctions|verifiers|passports|notifications|agents\/|owners\/|status|profile\/)/.test(
            text,
          ) &&
          text.includes("ponderBaseUrl")
        ) {
          if (!text.includes('from "@/lib/web3/ponder-fetch"') && !text.includes("from '../lib/web3/ponder-fetch")) {
            // app/lib imports always use @/
            if (!text.includes("@/lib/web3/ponder-fetch")) {
              missing.push(`${path.relative(ROOT, file)}: missing ponder-fetch import`);
            }
          }
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
