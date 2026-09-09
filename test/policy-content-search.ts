/**
 * Sole content-search owner for architectural policy tests.
 *
 * Host rg is not installed on GitHub Actions runners. Policy suites must not
 * shell out to it — they call this module instead (line-oriented, default-rg
 * semantics unless multiline is set).
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type ContentSearchOpts = {
  /** Absolute paths: files and/or directories. */
  paths: readonly string[];
  /** Include globs (rg --glob). Omit = every non-excluded file under dirs. */
  includeGlobs?: readonly string[];
  /** Extra exclude globs. /target/ and /node_modules/ are always skipped. */
  excludeGlobs?: readonly string[];
  caseInsensitive?: boolean;
  /** Match across lines (rg -U). Default false. */
  multiline?: boolean;
};

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function isAlwaysExcluded(absPath: string): boolean {
  const n = toPosix(absPath);
  return (
    n.includes("/target/") ||
    n.endsWith("/target") ||
    n.includes("/node_modules/") ||
    n.endsWith("/node_modules")
  );
}

/** Enough glob coverage for the SVM policy suites (*.rs and star-star/name/star-star). */
function matchesIncludeGlob(relPosix: string, glob: string): boolean {
  if (glob === "*.rs") return relPosix.endsWith(".rs");
  if (glob.startsWith("**/") && glob.endsWith("/**")) {
    const mid = glob.slice(3, -3);
    return (
      relPosix === mid ||
      relPosix.startsWith(`${mid}/`) ||
      relPosix.includes(`/${mid}/`)
    );
  }
  // Fallback: convert * / ** to RegExp against the relative path.
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re).test(relPosix);
}

function matchesAnyInclude(
  absPath: string,
  scanRoot: string,
  includeGlobs: readonly string[] | undefined,
): boolean {
  if (!includeGlobs || includeGlobs.length === 0) return true;
  const rel = toPosix(relative(scanRoot, absPath));
  return includeGlobs.some((g) => matchesIncludeGlob(rel, g));
}

function matchesExtraExclude(
  absPath: string,
  scanRoot: string,
  excludeGlobs: readonly string[] | undefined,
): boolean {
  if (!excludeGlobs || excludeGlobs.length === 0) return false;
  const rel = toPosix(relative(scanRoot, absPath));
  return excludeGlobs.some((g) => {
    const bare = g.startsWith("!") ? g.slice(1) : g;
    return matchesIncludeGlob(rel, bare) || matchesIncludeGlob(toPosix(absPath), bare);
  });
}

function collectFiles(opts: ContentSearchOpts): string[] {
  const out: string[] = [];

  function walk(dir: string, scanRoot: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (isAlwaysExcluded(full)) continue;
      if (matchesExtraExclude(full, scanRoot, opts.excludeGlobs)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, scanRoot);
      } else if (st.isFile() && matchesAnyInclude(full, scanRoot, opts.includeGlobs)) {
        out.push(full);
      }
    }
  }

  for (const p of opts.paths) {
    if (!existsSync(p)) continue;
    if (isAlwaysExcluded(p)) continue;
    const st = statSync(p);
    if (st.isFile()) {
      // Explicit file paths are searched even when include globs would skip them
      // (matches: rg pattern file.rs).
      out.push(p);
    } else if (st.isDirectory()) {
      walk(p, p);
    }
  }
  return out;
}

/**
 * Search paths; returns rg-style path:line:content lines joined by newline.
 * Empty string when there are no matches (rg exit 1).
 */
export function searchContent(pattern: string, opts: ContentSearchOpts): string {
  const files = collectFiles(opts);
  const flags = opts.caseInsensitive ? "i" : "";
  const re = new RegExp(pattern, flags);
  const hits: string[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (opts.multiline) {
      re.lastIndex = 0;
      if (re.test(text)) {
        // Line of first match for a stable, non-empty hit string.
        const idx = text.search(re);
        const line = text.slice(0, Math.max(0, idx)).split(/\r?\n/).length;
        const lineText = text.split(/\r?\n/)[line - 1] ?? "";
        hits.push(`${file}:${line}:${lineText}`);
      }
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i]!)) {
        hits.push(`${file}:${i + 1}:${lines[i]}`);
      }
    }
  }
  return hits.join("\n");
}

/**
 * Directory walk with include globs (money / consignment / event-parity shape).
 * Always skips target/ and node_modules/.
 */
export function searchUnder(
  pattern: string,
  cwd: string,
  includeGlobs: readonly string[],
  opts?: { caseInsensitive?: boolean; multiline?: boolean },
): string {
  return searchContent(pattern, {
    paths: [cwd],
    includeGlobs,
    caseInsensitive: opts?.caseInsensitive,
    multiline: opts?.multiline,
  });
}

/**
 * Search explicit files and/or directories (ascending / fixed-price shape).
 * Case-insensitive by default (historical rg -i).
 */
export function searchPaths(
  pattern: string,
  paths: readonly string[],
  opts?: { caseInsensitive?: boolean },
): string {
  return searchContent(pattern, {
    paths,
    caseInsensitive: opts?.caseInsensitive ?? true,
  });
}
