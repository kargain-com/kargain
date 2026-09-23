/**
 * Sole owner: no scratch left in the tree.
 *
 * Half A — every file under `svm/lab/scripts` is reachable from a package.json
 * script target or cited by `svm/lab/RESULTS.md`.
 * Half B — every file path named by a package.json script entry resolves to an
 * existing file (relative to that package.json).
 *
 * Lives under `test/` so a lab-sweep commit does not touch product `lib/`.
 */

/** File extensions that a script body may name as a runnable target. */
const SCRIPT_TARGET_EXT = String.raw`(?:ts|tsx|js|mjs|cjs|sh|toml|json)`;

/**
 * Path-like tokens in a script body. Covers `tsx path`, `node … path`,
 * `hardhat run path`, `bash path`, bare `scripts/…` / `test/…`, and
 * `--manifest-path path`.
 */
const SCRIPT_FILE_TOKEN_RE = new RegExp(
  String.raw`(?:^|[\s;&|=])(?:(?:tsx|ts-node|node|bash|sh|hardhat)\b(?:\s+(?:--[^\s=]+(?:=[^\s]*)?))*(?:\s+run)?\s+)?(\.?\/?(?:[\w.@+-]+\/)+[\w.@+-]+\.${SCRIPT_TARGET_EXT})\b`,
  "g",
);

const BARE_PROJECT_PATH_RE = new RegExp(
  String.raw`(?:^|[\s;&|])((?:\.\/)?(?:scripts|test|lib|src|svm|hooks|app|components|contracts)\/[\w./@+-]+\.${SCRIPT_TARGET_EXT})\b`,
  "g",
);

const MANIFEST_PATH_RE =
  /--manifest-path(?:=|\s+)(\.?\/?[\w./@+-]+\.(?:toml|json))\b/g;

export function extractScriptFileTargets(scriptBody: string): string[] {
  const hits = new Set<string>();
  for (const re of [SCRIPT_FILE_TOKEN_RE, BARE_PROJECT_PATH_RE, MANIFEST_PATH_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(scriptBody)) !== null) {
      const tok = m[1]!;
      if (tok.startsWith("-")) continue;
      hits.add(tok.replace(/^\.\//, ""));
    }
  }
  return [...hits].sort();
}

export type MissingPackageScriptTarget = {
  packageJsonRel: string;
  scriptName: string;
  targetAsWritten: string;
  resolvedRel: string;
};

export type PackageScriptsInput = {
  /** Repo-relative path of the package.json (e.g. `svm/lab/package.json`). */
  packageJsonRel: string;
  scripts: Record<string, string>;
};

/**
 * Resolve a target written in a package.json script to a repo-relative path.
 * `packageJsonRel` of `svm/lab/package.json` + `scripts/foo.ts` → `svm/lab/scripts/foo.ts`.
 */
export function resolveScriptTargetFromPackage(
  packageJsonRel: string,
  targetAsWritten: string,
): string {
  const pkgDir = packageJsonRel.includes("/")
    ? packageJsonRel.slice(0, packageJsonRel.lastIndexOf("/"))
    : "";
  const cleaned = targetAsWritten.replace(/^\.\//, "");
  if (!pkgDir) return cleaned;
  return `${pkgDir}/${cleaned}`.replace(/\/+/g, "/");
}

export function findMissingPackageScriptTargets(args: {
  packages: readonly PackageScriptsInput[];
  exists: (repoRel: string) => boolean;
}): MissingPackageScriptTarget[] {
  const missing: MissingPackageScriptTarget[] = [];
  for (const pkg of args.packages) {
    for (const [scriptName, body] of Object.entries(pkg.scripts)) {
      for (const targetAsWritten of extractScriptFileTargets(body)) {
        const resolvedRel = resolveScriptTargetFromPackage(
          pkg.packageJsonRel,
          targetAsWritten,
        );
        if (!args.exists(resolvedRel)) {
          missing.push({
            packageJsonRel: pkg.packageJsonRel,
            scriptName,
            targetAsWritten,
            resolvedRel,
          });
        }
      }
    }
  }
  return missing.sort((a, b) =>
    `${a.packageJsonRel}:${a.scriptName}:${a.resolvedRel}`.localeCompare(
      `${b.packageJsonRel}:${b.scriptName}:${b.resolvedRel}`,
    ),
  );
}

/** Repo-relative files named by any package.json script body. */
export function packageScriptReachableFiles(
  packages: readonly PackageScriptsInput[],
): Set<string> {
  const out = new Set<string>();
  for (const pkg of packages) {
    for (const body of Object.values(pkg.scripts)) {
      for (const t of extractScriptFileTargets(body)) {
        out.add(resolveScriptTargetFromPackage(pkg.packageJsonRel, t));
      }
    }
  }
  return out;
}

/**
 * A lab script is cited by RESULTS when the markdown names its basename
 * (path form `scripts/<name>` or bare `<name>`).
 */
export function resultsCitesLabScript(
  resultsMarkdown: string,
  labScriptBasename: string,
): boolean {
  if (resultsMarkdown.includes(`scripts/${labScriptBasename}`)) return true;
  if (resultsMarkdown.includes(labScriptBasename)) return true;
  return false;
}

export type UnreachableLabScript = {
  repoRel: string;
  basename: string;
};

/**
 * Half A: lab scripts with neither a package.json script target nor a RESULTS cite.
 * `labScriptRels` are repo-relative (e.g. `svm/lab/scripts/foo.ts`).
 */
export function findUnreachableLabScripts(args: {
  labScriptRels: readonly string[];
  packages: readonly PackageScriptsInput[];
  resultsMarkdown: string;
}): UnreachableLabScript[] {
  const reachable = packageScriptReachableFiles(args.packages);
  const out: UnreachableLabScript[] = [];
  for (const repoRel of args.labScriptRels) {
    const basename = repoRel.includes("/")
      ? repoRel.slice(repoRel.lastIndexOf("/") + 1)
      : repoRel;
    if (reachable.has(repoRel)) continue;
    if (resultsCitesLabScript(args.resultsMarkdown, basename)) continue;
    out.push({ repoRel, basename });
  }
  return out.sort((a, b) => a.repoRel.localeCompare(b.repoRel));
}
