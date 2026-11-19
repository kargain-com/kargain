/**
 * `.env.example` as the sole catalog of product/runtime environment keys.
 * Every literal or prefix `process.env.X` read under the runtime roots must
 * appear in `.env.example` as `KEY=` or `# KEY=` (prefixes as `PREFIX_*=` or
 * `PREFIX_<name>=` with a trailing underscore before the placeholder).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  scanProcessEnvReads,
  type ProcessEnvRead,
} from "./ponder-indexing-env-census.ts";

/** Roots that ship user-facing or indexer/ingest runtime. */
export const ENV_COVERAGE_SCAN_ROOTS = [
  "app",
  "components",
  "hooks",
  "lib",
  "src",
  "svm-ingest",
] as const;

export type EnvExampleDeclaration = {
  /** Exact key, or prefix ending in `_` (matches `PREFIX_*` reads). */
  key: string;
  /** True when the declaration is a prefix (`FOO_*` / `FOO_<id>`). */
  prefix: boolean;
  line: number;
};

export type EnvExampleCoverage = {
  declarations: EnvExampleDeclaration[];
  reads: ProcessEnvRead[];
  /** Distinct key/prefix tokens required by reads (opaque excluded). */
  readTokens: string[];
  /** Read tokens with no matching declaration. */
  missing: string[];
  declarationCount: number;
  readTokenCount: number;
};

/** `KEY=` / `# KEY=` / `# KEY_<id>=` / `# KEY_*=` */
const KEY_LINE_RE =
  /^\s*#?\s*([A-Z][A-Z0-9_]*)(?:<[^>=]+>|\*)?\s*=/;

/**
 * Parse declared keys from `.env.example` text.
 * `FOO_<anything>` or `FOO_*=` becomes prefix `FOO_`.
 */
export function parseEnvExampleDeclarations(
  source: string,
): EnvExampleDeclaration[] {
  const out: EnvExampleDeclaration[] = [];
  const seen = new Set<string>();
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = KEY_LINE_RE.exec(line);
    if (!m) continue;
    let key = m[1]!;
    const matched = m[0]!;
    const prefix =
      /<[^>=]+>|\*/.test(matched.slice(0, matched.lastIndexOf("="))) &&
      key.endsWith("_");
    if (prefix && !key.endsWith("_")) continue;
    if (!prefix && key.endsWith("_")) {
      // Bare `FOO_=` is not a valid exact key; treat as prefix only when marked.
      continue;
    }
    const id = prefix ? `${key}*` : key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ key, prefix, line: i + 1 });
  }
  return out;
}

function declarationCovers(
  declarations: readonly EnvExampleDeclaration[],
  read: ProcessEnvRead,
): boolean {
  if (read.kind === "opaque") return false;
  if (read.kind === "prefix") {
    return declarations.some((d) => d.prefix && d.key === read.prefix);
  }
  return declarations.some((d) => {
    if (!d.prefix) return d.key === read.key;
    return read.key.startsWith(d.key);
  });
}

function readToken(read: ProcessEnvRead): string | null {
  if (read.kind === "key") return read.key;
  if (read.kind === "prefix") return `${read.prefix}*`;
  return null;
}

export function envExampleCoverage(
  exampleSource: string,
  reads: readonly ProcessEnvRead[],
): EnvExampleCoverage {
  const declarations = parseEnvExampleDeclarations(exampleSource);
  const named = reads.filter((r) => r.kind !== "opaque");
  const tokenSet = new Set<string>();
  for (const r of named) {
    const t = readToken(r);
    if (t) tokenSet.add(t);
  }
  const readTokens = [...tokenSet].sort();
  const missing = readTokens.filter((token) => {
    const synthetic: ProcessEnvRead =
      token.endsWith("*")
        ? { file: "", line: 0, kind: "prefix", prefix: token.slice(0, -1) }
        : { file: "", line: 0, kind: "key", key: token };
    return !declarationCovers(declarations, synthetic);
  });
  return {
    declarations,
    reads: [...reads],
    readTokens,
    missing,
    declarationCount: declarations.length,
    readTokenCount: readTokens.length,
  };
}

function walkSourceFiles(rootDir: string, relRoot: string, out: string[]): void {
  const abs = join(rootDir, relRoot);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist") continue;
    const rel = join(relRoot, name);
    const st = statSync(join(rootDir, rel));
    if (st.isDirectory()) walkSourceFiles(rootDir, rel, out);
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name)) out.push(rel);
  }
}

/** Live `process.env` reads under {@link ENV_COVERAGE_SCAN_ROOTS}. */
export function scanRuntimeEnvReads(rootDir: string): ProcessEnvRead[] {
  const files: string[] = [];
  for (const root of ENV_COVERAGE_SCAN_ROOTS) {
    walkSourceFiles(rootDir, root, files);
  }
  const reads: ProcessEnvRead[] = [];
  for (const rel of files) {
    reads.push(
      ...scanProcessEnvReads(rel, readFileSync(join(rootDir, rel), "utf8")),
    );
  }
  return reads;
}

export function liveEnvExampleCoverage(rootDir: string): EnvExampleCoverage {
  const example = readFileSync(join(rootDir, ".env.example"), "utf8");
  return envExampleCoverage(example, scanRuntimeEnvReads(rootDir));
}
