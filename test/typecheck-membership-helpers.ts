/**
 * Shared typecheck membership helpers (D-1).
 * Walk + parseJsonConfigFileContent — not tsc --listFiles.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import {
  TYPECHECK_PROJECTS,
  type TypecheckProject,
} from "../lib/architecture/typecheck-projects.ts";

/** Directory names skipped while walking for TypeScript sources. */
export const TYPECHECK_WALK_SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "target",
  "coverage",
  "artifacts",
  "cache",
  ".ponder",
  "dist",
  "out",
  "typechain-types",
]);

/**
 * Walk repository `.ts`/`.tsx` sources that must belong to a typecheck project.
 * Skips generated `.next/types`, declaration-only ambient files that are
 * project-owned via include (next-env.d.ts / ponder-env.d.ts still counted when
 * present as roots), and walk-skip dirs.
 */
export function walkTypecheckCandidateFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (TYPECHECK_WALK_SKIP_DIRS.has(entry.name)) continue;
        // svm/lab/node_modules already covered by node_modules name
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      // Generated Next types — owned by app include but not walked as product
      if (rel.startsWith(".next/")) continue;
      out.push(rel);
    }
  }
  walk(root);
  return out.sort();
}

/** Absolute paths from parseJsonConfigFileContent, normalized to repo-relative posix. */
export function projectRootFileNames(
  root: string,
  project: TypecheckProject,
): Set<string> {
  const configPath = path.join(root, project.tsconfig);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `Failed to read ${project.tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );
  const names = new Set<string>();
  for (const abs of parsed.fileNames) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(".next/")) continue;
    if (rel.includes("node_modules/")) continue;
    names.add(rel);
  }
  return names;
}

export type TypecheckMembership = Map<string, string[]>;

export function buildTypecheckMembership(root: string): TypecheckMembership {
  const projectFiles = TYPECHECK_PROJECTS.map((p) => ({
    id: p.id,
    files: projectRootFileNames(root, p),
  }));
  const membership: TypecheckMembership = new Map();
  for (const rel of walkTypecheckCandidateFiles(root)) {
    const owners: string[] = [];
    for (const { id, files } of projectFiles) {
      if (files.has(rel)) owners.push(id);
    }
    membership.set(rel, owners);
  }
  return membership;
}

export function findMembershipViolations(
  membership: TypecheckMembership,
): { none: string[]; dual: Array<{ file: string; projects: string[] }> } {
  const none: string[] = [];
  const dual: Array<{ file: string; projects: string[] }> = [];
  for (const [file, projects] of membership) {
    if (projects.length === 0) none.push(file);
    else if (projects.length >= 2) {
      dual.push({ file, projects: [...projects].sort() });
    }
  }
  return {
    none: none.sort(),
    dual: dual.sort((a, b) => a.file.localeCompare(b.file)),
  };
}

/** Extract `-p <path>` targets from a package.json typecheck script body. */
export function parseTypecheckProjectFlags(scriptBody: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s;&|])(?:tsc\b[^\n]*?)\s+-p\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scriptBody)) !== null) {
    out.push(m[1]!.replace(/^['"]|['"]$/g, ""));
  }
  // Also handle chained pnpm typecheck:* that expand — require direct -p
  return out;
}
