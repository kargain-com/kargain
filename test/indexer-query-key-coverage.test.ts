import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INDEXER_QUERY_KEY_PREFIXES,
  NON_INDEXER_QUERY_KEY_PREFIXES,
} from "../lib/web3/indexer-query-keys.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Client RQ sites — server actions do not own React Query keys. */
const SCAN_DIRS = [path.join(ROOT, "hooks"), path.join(ROOT, "components")] as const;

/**
 * `queryKey: ["prefix", …]` or `queryKey: SOME_CONST` where
 * `const SOME_CONST = ["prefix", …] as const` in the same file.
 */
const LITERAL_QUERY_KEY_RE = /queryKey:\s*\[\s*["']([a-zA-Z0-9_-]+)["']/g;
const CONST_QUERY_KEY_RE = /queryKey:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const CONST_DEF_RE =
  /(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[\s*["']([a-zA-Z0-9_-]+)["']/g;

const ALLOWED = new Set<string>([
  ...INDEXER_QUERY_KEY_PREFIXES,
  ...NON_INDEXER_QUERY_KEY_PREFIXES,
]);

function listTsFiles(dir: string): string[] {
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

function constPrefixMap(text: string): Map<string, string> {
  const map = new Map<string, string>();
  CONST_DEF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONST_DEF_RE.exec(text)) !== null) {
    map.set(match[1]!, match[2]!);
  }
  return map;
}

function collectPrefixes(text: string): string[] {
  const prefixes: string[] = [];
  const consts = constPrefixMap(text);

  LITERAL_QUERY_KEY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LITERAL_QUERY_KEY_RE.exec(text)) !== null) {
    prefixes.push(match[1]!);
  }

  CONST_QUERY_KEY_RE.lastIndex = 0;
  while ((match = CONST_QUERY_KEY_RE.exec(text)) !== null) {
    const name = match[1]!;
    // Skip `queryKey: ["…"]` already handled (name would not match identifier-only).
    const resolved = consts.get(name);
    if (resolved) prefixes.push(resolved);
  }

  return prefixes;
}

describe("indexer query key coverage", () => {
  it("registers every scanned queryKey prefix as indexer or non-indexer", () => {
    const found = new Map<string, string[]>();

    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        const rel = path.relative(ROOT, file);
        if (rel === "hooks/use-tx-sync.ts") continue;

        const text = fs.readFileSync(file, "utf8");
        for (const prefix of collectPrefixes(text)) {
          const list = found.get(prefix) ?? [];
          list.push(rel);
          found.set(prefix, list);
        }
      }
    }

    const unregistered = [...found.keys()]
      .filter((p) => !ALLOWED.has(p))
      .sort();

    assert.deepEqual(
      unregistered,
      [],
      `Unregistered queryKey prefixes (add to INDEXER_QUERY_KEY_PREFIXES or NON_INDEXER_QUERY_KEY_PREFIXES):\n${unregistered
        .map((p) => `  ${p} ← ${[...new Set(found.get(p)!)].join(", ")}`)
        .join("\n")}`,
    );
  });

  it("requires listing-facets and kar-pro-slug-availability in the indexer registry", () => {
    const set = new Set(INDEXER_QUERY_KEY_PREFIXES);
    assert.ok(set.has("listing-facets"));
    assert.ok(set.has("kar-pro-slug-availability"));
  });
});
