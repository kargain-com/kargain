/**
 * Policy: Ponder projection reads go through tagged `"use cache"` (T3).
 * Tags ∈ INDEXER_QUERY_KEY_PREFIXES. Wait instruments (status / live passport)
 * may use uncached transport.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { INDEXER_QUERY_KEY_PREFIXES } from "../lib/web3/indexer-query-keys.ts";

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
  path.join(ROOT, "lib/web3/ponder-urls.ts"),
  path.join(ROOT, "lib/web3/ponder-client.ts"),
  path.join(ROOT, "lib/web3/ponder-tagged-read.ts"),
  path.join(ROOT, "lib/web3/ponder-endpoints.ts"),
  path.join(ROOT, "lib/web3/ponder-ids.ts"),
  path.join(ROOT, "lib/web3/indexer-query-keys.ts"),
]);

/** May call transport / live opts — T4 wait + catch-up polls. */
const LIVE_ALLOWLIST = new Set([
  path.join(ROOT, "app/actions/indexer-status.ts"),
  path.join(ROOT, "app/actions/passport-detail.ts"),
  path.join(ROOT, "lib/passport/fetch-passport-detail.ts"),
  path.join(ROOT, "lib/vincent-commons/observations-source.ts"),
]);

const PREFIX_SET = new Set<string>(INDEXER_QUERY_KEY_PREFIXES);

const FORBIDDEN = [
  { name: "revalidate: 30", re: /revalidate:\s*30/ },
  { name: "fresh?:", re: /fresh\?:/ },
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
  it("forbids dual-path Data Cache hints on mutable Ponder callers", () => {
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
          missing.push(
            `${path.relative(ROOT, file)}: still uses PONDER_SQL_API_URL`,
          );
        }
        const touchesPonder =
          text.includes("ponderFetch(") ||
          text.includes("ponderBaseUrl") ||
          text.includes("buildPonderUrl") ||
          text.includes("buildConsignmentsListUrl") ||
          text.includes("fetchConsignmentByToken") ||
          text.includes("fetchPassportByToken") ||
          text.includes("fetchStatus") ||
          text.includes("ponderGet") ||
          text.includes("ponderTaggedJson");
        if (!touchesPonder) continue;
        if (
          !text.includes("@/lib/web3/ponder-fetch") &&
          !text.includes("@/lib/web3/ponder-urls") &&
          !LIVE_ALLOWLIST.has(file)
        ) {
          missing.push(
            `${path.relative(ROOT, file)}: missing ponder-fetch import`,
          );
        }
        if (/new URL\(\s*`\$\{ponderBaseUrl\(\)\}/.test(text)) {
          missing.push(
            `${path.relative(ROOT, file)}: manual URL from ponderBaseUrl`,
          );
        }
      }
    }
    assert.deepEqual(missing, []);
  });

  it("ponderFetch call sites pass a known IndexerQueryKeyPrefix tag", () => {
    const violations: string[] = [];
    const callRe = /ponderFetch\(\s*["']([^"']+)["']/g;
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (OWNER_FILES.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        let m: RegExpExecArray | null;
        callRe.lastIndex = 0;
        while ((m = callRe.exec(text)) !== null) {
          const tag = m[1]!;
          if (!PREFIX_SET.has(tag)) {
            violations.push(
              `${path.relative(ROOT, file)}: unknown tag "${tag}"`,
            );
          }
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("tagged-read module is the sole use-cache + cacheTag owner for Ponder", () => {
    const tagged = fs.readFileSync(
      path.join(ROOT, "lib/web3/ponder-tagged-read.ts"),
      "utf8",
    );
    assert.match(tagged, /["']use cache["']/);
    assert.match(tagged, /cacheTag\(/);
    assert.match(tagged, /cacheLife\(/);

    const violations: string[] = [];
    for (const dir of [
      path.join(ROOT, "app"),
      path.join(ROOT, "lib"),
      path.join(ROOT, "hooks"),
    ]) {
      for (const file of listTsFiles(dir)) {
        if (file.endsWith("ponder-tagged-read.ts")) continue;
        const text = fs.readFileSync(file, "utf8");
        if (text.includes("cacheTag(") && text.includes("ponder")) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("bans ponderTransportFetch outside owner + live allowlist", () => {
    const violations: string[] = [];
    const allowed = new Set([...OWNER_FILES, ...LIVE_ALLOWLIST]);
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (allowed.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (
          text.includes("ponderTransportFetch") ||
          text.includes("ponderStatusFetch")
        ) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
