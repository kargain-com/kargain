/**
 * Sole owner of the Ponder indexing-file glob — the same path set Ponder 0.18
 * hashes and executes for build_id. Mirrors glob.sync under src/ for
 * js/mjs/ts/mts, ignoring src/api/ and test/spec files, with glob 10 default
 * dot:false. Does not equal or predict build_id.
 *
 * Guard: test/ponder-indexing-glob-svm-isolation-policy.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Indexing directory Ponder walks (common.options.indexingDir). */
export const PONDER_INDEXING_DIR = "src" as const;

/** API tree Ponder ignores from the indexing hash/execution set. */
export const PONDER_INDEXING_API_DIR = "src/api" as const;

const INDEXING_EXT_RE = /\.(?:js|mjs|ts|mts)$/;
/** Ponder ignore: test/spec files under the indexing dir. */
const TEST_FILE_RE = /\.(?:test|spec)\.(?:js|mjs|ts|mts)$/;

function isDotSegment(name: string): boolean {
  return name.startsWith(".");
}

function walkPonderIndexing(root: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir);
  for (const name of entries) {
    // glob 10 default `dot: false` — skip dotfiles and dot directories.
    if (isDotSegment(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkPonderIndexing(root, full, out);
      continue;
    }
    // Brace set is js/mjs/ts/mts — `.d.ts` matches `*.ts`; `.tsx` does not.
    if (!INDEXING_EXT_RE.test(name)) continue;
    if (TEST_FILE_RE.test(name)) continue;
    const rel = relative(root, full).replace(/\\/g, "/");
    const apiPrefix = `${PONDER_INDEXING_API_DIR}/`;
    if (rel === PONDER_INDEXING_API_DIR || rel.startsWith(apiPrefix)) continue;
    out.push(rel);
  }
}

/**
 * List relative paths Ponder would include in its indexing content hash.
 * Fail closed when `src/` is missing/unreadable or the match set is empty.
 */
export function listPonderIndexingGlob(root: string): string[] {
  const indexingDir = join(root, PONDER_INDEXING_DIR);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(indexingDir);
  } catch {
    throw new Error(
      `Ponder indexing dir unreadable: ${PONDER_INDEXING_DIR}/`,
    );
  }
  if (!st.isDirectory()) {
    throw new Error(
      `Ponder indexing dir unreadable: ${PONDER_INDEXING_DIR}/`,
    );
  }
  const found: string[] = [];
  walkPonderIndexing(root, indexingDir, found);
  if (found.length === 0) {
    throw new Error(
      `Ponder indexing glob empty under ${PONDER_INDEXING_DIR}/`,
    );
  }
  return found.sort();
}

/**
 * Resolve the svm-ingest process entry from its single definition:
 * `package.json` scripts["svm-ingest:start"] (Dockerfile.svm-ingest runs it).
 */
export function resolveSvmIngestStartEntry(root: string): string {
  const pkgPath = join(root, "package.json");
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
  } catch {
    throw new Error("svm-ingest:start unresolved: package.json unreadable");
  }
  const script = pkg.scripts?.["svm-ingest:start"]?.trim();
  if (!script) {
    throw new Error('svm-ingest:start unresolved: scripts["svm-ingest:start"] missing');
  }
  const tokens = script.split(/\s+/).filter(Boolean);
  let entry: string | undefined;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const tok = tokens[i]!;
    if (tok.startsWith("-")) continue;
    if (/\.(?:ts|js|mts|mjs)$/.test(tok)) {
      entry = tok;
      break;
    }
  }
  if (!entry) {
    throw new Error(
      `svm-ingest:start unresolved: no entry path in ${JSON.stringify(script)}`,
    );
  }
  return entry.replace(/^\.\//, "").replace(/\\/g, "/");
}

/**
 * Defect when any svm-ingest-owned module (static import closure of the
 * service entry) appears in the Ponder indexing glob. null when isolated.
 * Fail closed on an empty owned set.
 */
export function ponderIndexingSvmIngestDefect(
  indexingRels: readonly string[],
  ownedRels: readonly string[],
): string | null {
  if (ownedRels.length === 0) {
    throw new Error("svm-ingest import closure is empty");
  }
  const indexingSet = new Set(indexingRels);
  const overlap = ownedRels.filter((rel) => indexingSet.has(rel)).sort();
  if (overlap.length > 0) {
    return `Ponder indexing glob includes svm-ingest-owned modules:\n${overlap.join("\n")}`;
  }
  return null;
}
