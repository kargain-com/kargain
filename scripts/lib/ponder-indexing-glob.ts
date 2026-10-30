/**
 * Sole owner of the Ponder indexing-file glob — the same path set Ponder 0.18
 * hashes and executes for build_id (under src/, extensions js/mjs/ts/mts,
 * ignoring src/api/ and test/spec files). Does not equal or predict build_id.
 *
 * Guard: test/ponder-indexing-glob-svm-isolation-policy.test.ts
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Indexing directory Ponder walks (common.options.indexingDir). */
export const PONDER_INDEXING_DIR = "src" as const;

/** API tree Ponder ignores from the indexing hash/execution set. */
export const PONDER_INDEXING_API_DIR = "src/api" as const;

/** Repo-root home of svm-ingest-owned modules (outside the indexing glob). */
export const SVM_INGEST_ROOT = "svm-ingest" as const;

/**
 * Paths that must never appear in the Ponder indexing glob. Historical
 * locations under src/ stay listed so a regression that puts ingest back
 * under src/ fails even if svm-ingest/ is also present.
 */
export const SVM_INGEST_BANNED_IN_PONDER_GLOB = [
  "src/svm-ingest/",
  "src/lib/svm-raw-writer.ts",
  "src/lib/svm-projection-writer.ts",
] as const;

const INDEXING_EXT_RE = /\.(?:js|mjs|ts|mts)$/;
const TEST_FILE_RE = /\.(?:test|spec)\.(?:js|mjs|ts|mts)$/;

function isBannedInPonderGlob(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/");
  for (const ban of SVM_INGEST_BANNED_IN_PONDER_GLOB) {
    if (ban.endsWith("/")) {
      if (normalized.startsWith(ban)) return true;
    } else if (normalized === ban) {
      return true;
    }
  }
  return false;
}

function walkTsLike(root: string, dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsLike(root, full, out);
      continue;
    }
    if (!INDEXING_EXT_RE.test(name) || name.endsWith(".d.ts")) continue;
    if (TEST_FILE_RE.test(name)) continue;
    out.push(relative(root, full).replace(/\\/g, "/"));
  }
}

/**
 * List relative paths Ponder would include in its indexing content hash.
 * Matches ponder/src/build/index.ts indexingPattern + api/test ignores.
 */
export function listPonderIndexingGlob(root: string): string[] {
  const found: string[] = [];
  walkTsLike(root, join(root, PONDER_INDEXING_DIR), found);
  const apiPrefix = `${PONDER_INDEXING_API_DIR}/`;
  return found
    .filter((rel) => rel !== PONDER_INDEXING_API_DIR && !rel.startsWith(apiPrefix))
    .sort();
}

/**
 * svm-ingest-owned TypeScript/JS modules under the dedicated root.
 * Injectable via opts.ownedRels for constructed tests.
 */
export function listSvmIngestOwnedModules(
  root: string,
  opts?: { ownedRels?: readonly string[] },
): string[] {
  if (opts?.ownedRels) return [...opts.ownedRels].sort();
  const found: string[] = [];
  walkTsLike(root, join(root, SVM_INGEST_ROOT), found);
  return found.sort();
}

/**
 * Defect when any Ponder indexing path is svm-ingest-owned (banned under src/
 * or overlapping the dedicated svm-ingest/ tree). null when isolated.
 */
export function ponderIndexingSvmIngestDefect(
  indexingRels: readonly string[],
  ownedRels: readonly string[],
): string | null {
  if (ownedRels.length === 0) {
    return `svm-ingest owned modules missing under ${SVM_INGEST_ROOT}/`;
  }
  const indexingSet = new Set(indexingRels);
  const bannedHits = indexingRels.filter((rel) => isBannedInPonderGlob(rel));
  if (bannedHits.length > 0) {
    return `Ponder indexing glob includes svm-ingest-owned paths:\n${bannedHits.join("\n")}`;
  }
  const overlap = ownedRels.filter((rel) => indexingSet.has(rel));
  if (overlap.length > 0) {
    return `Ponder indexing glob overlaps svm-ingest owned modules:\n${overlap.join("\n")}`;
  }
  return null;
}
