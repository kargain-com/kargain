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
  path.join(ROOT, "lib/kar-pro"),
  path.join(ROOT, "lib/vincent-commons"),
] as const;

/** Content-addressed blobs may keep TTL — not mutable Ponder state. */
const ALLOWLIST = new Set([
  path.join(ROOT, "lib/passport/fetch-arweave-metadata.ts"),
  path.join(ROOT, "lib/kar-pro/fetch-kar-pro-metadata.ts"),
]);

const OWNER_FILES = new Set([
  path.join(ROOT, "lib/web3/ponder-fetch.ts"),
  path.join(ROOT, "lib/web3/ponder-fetch-transport.ts"),
  path.join(ROOT, "lib/web3/ponder-client.ts"),
  path.join(ROOT, "lib/web3/ponder-endpoints.ts"),
  path.join(ROOT, "lib/web3/ponder-ids.ts"),
]);

const FORBIDDEN = [
  { name: "revalidate: 30", re: /revalidate:\s*30/ },
  { name: "fresh?:", re: /fresh\?:/ },
  { name: 'cache: "no-store" inline', re: /cache:\s*"no-store"/ },
] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
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
        if (ALLOWLIST.has(file) || OWNER_FILES.has(file)) continue;
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

  it("routes scanned Ponder HTTP through @/lib/web3/ponder-fetch", () => {
    const missing: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (ALLOWLIST.has(file) || OWNER_FILES.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("PONDER_SQL_API_URL")) {
          missing.push(`${path.relative(ROOT, file)}: still uses PONDER_SQL_API_URL`);
        }
        const touchesPonder =
          text.includes("ponderFetch(") ||
          text.includes("ponderBaseUrl") ||
          text.includes("buildPonderUrl") ||
          text.includes("buildConsignmentsListUrl") ||
          text.includes("fetchConsignmentByToken") ||
          text.includes("fetchPassportByToken") ||
          text.includes("fetchStatus") ||
          text.includes("ponderGet");
        if (!touchesPonder) continue;
        if (!text.includes('@/lib/web3/ponder-fetch')) {
          missing.push(`${path.relative(ROOT, file)}: missing ponder-fetch import`);
        }
        if (/new URL\(\s*`\$\{ponderBaseUrl\(\)\}/.test(text)) {
          missing.push(`${path.relative(ROOT, file)}: manual URL from ponderBaseUrl`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
