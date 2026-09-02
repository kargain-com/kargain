/**
 * Network-scoped React Query keys must carry commercial namespace at [1]
 * via indexerQueryKey (S8-1).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  INDEXER_QUERY_KEY_PREFIXES,
  indexerQueryKey,
  NETWORK_SCOPED_INDEXER_PREFIXES,
  NETWORK_SCOPED_NON_INDEXER_PREFIXES,
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

const NETWORK_SCOPED = new Set<string>([
  ...NETWORK_SCOPED_INDEXER_PREFIXES,
  ...NETWORK_SCOPED_NON_INDEXER_PREFIXES,
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
    const resolved = consts.get(name);
    if (resolved) prefixes.push(resolved);
  }

  return prefixes;
}

/**
 * Literal network-scoped keys that bypass indexerQueryKey.
 * Allows `indexerQueryKey("prefix", …)` and helpers that return it.
 */
function networkScopedLiteralBypasses(text: string): string[] {
  const hits: string[] = [];
  const re =
    /queryKey:\s*\[\s*["']([a-zA-Z0-9_-]+)["']\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const prefix = match[1]!;
    if (NETWORK_SCOPED.has(prefix)) hits.push(prefix);
  }
  return hits;
}

/** Exported for constructed-violation proofs. */
export function isNetworkScopedKeyMissingNamespaceSegment(
  key: readonly unknown[],
): boolean {
  if (key.length < 2) return true;
  const prefix = key[0];
  if (typeof prefix !== "string" || !NETWORK_SCOPED.has(prefix)) return false;
  // Namespace must be a stringified commercial id — not an address-shaped first part.
  const ns = key[1];
  if (typeof ns !== "string" && typeof ns !== "number") return true;
  const s = String(ns);
  // Address as segment 1 (old kar-pro-verifier order) is a violation.
  if (s.startsWith("0x") || s.length > 20) return true;
  return false;
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

  it("requires kar-pro-slug-availability in the indexer registry", () => {
    const set = new Set(INDEXER_QUERY_KEY_PREFIXES);
    assert.ok(set.has("kar-pro-slug-availability"));
  });

  it("network-scoped prefixes are a subset of registered prefixes", () => {
    for (const p of NETWORK_SCOPED_INDEXER_PREFIXES) {
      assert.ok(
        (INDEXER_QUERY_KEY_PREFIXES as readonly string[]).includes(p),
        `missing indexer prefix ${p}`,
      );
    }
    for (const p of NETWORK_SCOPED_NON_INDEXER_PREFIXES) {
      assert.ok(
        (NON_INDEXER_QUERY_KEY_PREFIXES as readonly string[]).includes(p),
        `missing non-indexer prefix ${p}`,
      );
    }
  });

  it("no client literal queryKey bypasses indexerQueryKey for network-scoped prefixes", () => {
    const violations: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        const rel = path.relative(ROOT, file);
        const text = fs.readFileSync(file, "utf8");
        for (const prefix of networkScopedLiteralBypasses(text)) {
          violations.push(`${rel}: literal ${prefix}`);
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("indexerQueryKey places namespace at segment 1", () => {
    assert.deepEqual(indexerQueryKey("consignment-detail", 84532, "1"), [
      "consignment-detail",
      "84532",
      "1",
    ]);
  });

  it("negative: prefix + address-shaped segment without namespace builder is red", () => {
    const dirty = ["kar-pro-verifier", "0xabc", 84532] as const;
    assert.equal(isNetworkScopedKeyMissingNamespaceSegment(dirty), true);
    const good = indexerQueryKey("kar-pro-verifier", 84532, "0xabc");
    assert.equal(isNetworkScopedKeyMissingNamespaceSegment(good), false);
  });
});
