/**
 * Policy: Ponder HTTP reads go only through the typed catalog/client owner.
 * Catalog routes must exist in Hono (or be ponder-reserved); sent query keys
 * must be handler-read.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS,
  PONDER_FORBIDDEN_PATH_SUBSTRINGS,
  PONDER_IMPLEMENTED_ROUTES,
  consignmentsListQueryKeys,
} from "../lib/web3/ponder-endpoints.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OWNER_FILES = new Set([
  path.join(ROOT, "lib/web3/ponder-fetch.ts"),
  path.join(ROOT, "lib/web3/ponder-fetch-transport.ts"),
  path.join(ROOT, "lib/web3/ponder-client.ts"),
  path.join(ROOT, "lib/web3/ponder-endpoints.ts"),
  path.join(ROOT, "lib/web3/ponder-ids.ts"),
]);

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "lib"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "components"),
] as const;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function isCommentOrDocLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("*") ||
    t.startsWith("/*") ||
    t.includes("not registered") ||
    t.includes("retired")
  );
}

function readApiSources(): string {
  return (
    fs.readFileSync(path.join(ROOT, "src/api/index.ts"), "utf8") +
    "\n" +
    fs.readFileSync(path.join(ROOT, "src/api/commerce-routes.ts"), "utf8")
  );
}

function registeredHonoPaths(source: string): Set<string> {
  const paths = new Set<string>();
  const re = /app\.get\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    paths.add(m[1]!);
  }
  return paths;
}

function queryKeysReadInHandler(source: string, routePath: string): Set<string> {
  const marker = `app.get("${routePath}"`;
  const alt = `app.get('${routePath}'`;
  let start = source.indexOf(marker);
  if (start < 0) start = source.indexOf(alt);
  if (start < 0) return new Set();
  const from = source.slice(start);
  const next = from.search(/\n\s*app\.get\(/);
  const block = next > 0 ? from.slice(0, next) : from.slice(0, 8000);
  const keys = new Set<string>();
  const re = /c\.req\.query\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    keys.add(m[1]!);
  }
  return keys;
}

describe("ponder contract route policy", () => {
  it("every hono catalog path is registered on Hono", () => {
    const registered = registeredHonoPaths(readApiSources());
    const missing: string[] = [];
    for (const route of PONDER_IMPLEMENTED_ROUTES) {
      if (route.registration === "ponder-reserved") continue;
      if (!registered.has(route.path)) {
        missing.push(`${route.id}: ${route.path}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("catalog query keys for each hono route are read by the matching handler", () => {
    const source = readApiSources();
    const violations: string[] = [];
    for (const route of PONDER_IMPLEMENTED_ROUTES) {
      if (route.registration === "ponder-reserved") continue;
      const read = queryKeysReadInHandler(source, route.path);
      for (const key of route.query) {
        if (!read.has(key)) {
          violations.push(`${route.id}: query "${key}" not read by handler`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("consignments browse filter keys are in the catalog send set", () => {
    const allowed = new Set(consignmentsListQueryKeys());
    for (const key of CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS) {
      assert.equal(
        allowed.has(key),
        true,
        `browse filter key "${key}" must be in consignments.list catalog query`,
      );
    }
    assert.equal(CONSIGNMENT_BROWSE_FILTER_QUERY_KEYS.length, 32);
  });

  it("forbids dead Ponder API path strings outside the owner", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (OWNER_FILES.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        const rel = path.relative(ROOT, file);

        for (const needle of PONDER_FORBIDDEN_PATH_SUBSTRINGS) {
          if (needle === "/profile/") {
            if (/\/profile\/[^"'`\s]+\/listings/.test(text)) {
              const lines = text.split("\n").filter((l) =>
                /\/profile\/[^"'`\s]+\/listings/.test(l),
              );
              if (lines.some((l) => !isCommentOrDocLine(l))) {
                violations.push(`${rel}: /profile/…/listings`);
              }
            }
            continue;
          }
          if (!text.includes(needle)) continue;
          const lines = text.split("\n").filter((l) => l.includes(needle));
          if (lines.some((l) => !isCommentOrDocLine(l))) {
            violations.push(`${rel}: ${needle}`);
          }
        }

        if (/new URL\(\s*`\$\{ponderBaseUrl\(\)\}/.test(text)) {
          violations.push(`${rel}: manual new URL(\`\${ponderBaseUrl()}\`)`);
        }
        if (
          /new URL\(\s*`\$\{base\}/.test(text) &&
          text.includes("ponderBaseUrl") &&
          /const\s+base\s*=\s*ponderBaseUrl/.test(text)
        ) {
          violations.push(`${rel}: manual new URL(\`\${base}\`) with ponderBaseUrl`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("forbids casting to PonderConsignmentRow outside owner parsers", () => {
    const violations: string[] = [];
    const castRe = /\bas\s+PonderConsignmentRow\b/;
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (OWNER_FILES.has(file)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (castRe.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
