/**
 * `.env.example` as the sole catalog of product/runtime environment keys.
 *
 * The scanned file set is assembled by the policy suite as the union of:
 * - app trees (`app`, `components`, `hooks`, `lib`);
 * - Ponder executable closure (`collectPonderGraph(...).executable`);
 * - svm-ingest static-import closure (`collectStaticImportClosure`).
 *
 * Every named `process.env` / injected-env read in that set must appear in
 * `.env.example` as `KEY=` or `# KEY=` (prefixes as `KEY_<id>=`). Any remaining
 * opaque read fails the gate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  scanProcessEnvReadsInSources,
  type ProcessEnvRead,
} from "./ponder-indexing-env-census.ts";

/** App product trees (directory walk). */
export const ENV_COVERAGE_APP_ROOTS = [
  "app",
  "components",
  "hooks",
  "lib",
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
  /** Distinct key/prefix tokens required by reads. */
  readTokens: string[];
  /** Read tokens with no matching declaration. */
  missing: string[];
  /** Opaque reads that remain after binding resolution. */
  opaque: ProcessEnvRead[];
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
    const key = m[1]!;
    const matched = m[0]!;
    const prefix =
      /<[^>=]+>|\*/.test(matched.slice(0, matched.lastIndexOf("="))) &&
      key.endsWith("_");
    if (prefix && !key.endsWith("_")) continue;
    if (!prefix && key.endsWith("_")) continue;
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
  const opaque = reads.filter((r) => r.kind === "opaque");
  const named = reads.filter((r) => r.kind !== "opaque");
  const tokenSet = new Set<string>();
  for (const r of named) {
    const t = readToken(r);
    if (t) tokenSet.add(t);
  }
  const readTokens = [...tokenSet].sort();
  const missing = readTokens.filter((token) => {
    const synthetic: ProcessEnvRead = token.endsWith("*")
      ? { file: "", line: 0, kind: "prefix", prefix: token.slice(0, -1) }
      : { file: "", line: 0, kind: "key", key: token };
    return !declarationCovers(declarations, synthetic);
  });
  return {
    declarations,
    reads: [...reads],
    readTokens,
    missing,
    opaque,
    declarationCount: declarations.length,
    readTokenCount: readTokens.length,
  };
}

/** Walk one app root for TypeScript/JavaScript sources. */
export function walkEnvCoverageAppRoot(
  rootDir: string,
  relRoot: string,
): string[] {
  const out: string[] = [];
  const abs = join(rootDir, relRoot);
  if (!existsSync(abs)) return out;
  const walk = (rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(join(rootDir, rel));
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "dist") continue;
      const child = join(rel, name).replace(/\\/g, "/");
      const st = statSync(join(rootDir, child));
      if (st.isDirectory()) walk(child);
      else if (
        /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(name) &&
        !name.endsWith(".d.ts")
      ) {
        out.push(child);
      }
    }
  };
  walk(relRoot);
  return out;
}

/** Scan `process.env` reads in an explicit relative file list (one program). */
export function scanEnvReadsInFiles(
  rootDir: string,
  files: readonly string[],
): ProcessEnvRead[] {
  const entries: { file: string; source: string }[] = [];
  for (const rel of files) {
    const abs = join(rootDir, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    if (!/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(rel)) continue;
    entries.push({ file: rel.replace(/\\/g, "/"), source: readFileSync(abs, "utf8") });
  }
  return scanProcessEnvReadsInSources(entries);
}
