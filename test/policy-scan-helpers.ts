/**
 * Sole product ownership-policy scanner (S8-1-fix).
 * One root set for every place product code can live; policies supply only
 * a violation predicate (+ optional owner allowlist).
 *
 * Commercial-ABI enumeration also walks src/ + scripts/ + ponder.config.ts —
 * product roots alone miss those collection builders.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { builtinModules } from "node:module";

export const POLICY_SCAN_ROOT = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

/** Sole scan roots for ownership policies — do not fork a narrower set. */
export const PRODUCT_POLICY_SCAN_ROOTS = [
  "app",
  "components",
  "hooks",
  "lib",
] as const;

/** Additional repo roots needed for product graph reachability policies. */
export const PRODUCT_GRAPH_SCAN_ROOTS = [
  ...PRODUCT_POLICY_SCAN_ROOTS,
  "adapters",
] as const;

export type ProductPolicyScanRoot = (typeof PRODUCT_POLICY_SCAN_ROOTS)[number];

/**
 * Roots + root files where commercial ABI *collections* may be assembled.
 * Wider than PRODUCT_POLICY_SCAN_ROOTS (indexer + scripts + ponder config).
 */
export const COMMERCIAL_ABI_ENUMERATION_SCAN_ROOTS = [
  ...PRODUCT_POLICY_SCAN_ROOTS,
  "src",
  "scripts",
] as const;

export const COMMERCIAL_ABI_ENUMERATION_ROOT_FILES = [
  "ponder.config.ts",
] as const;

export type ProductSourceHit = { path: string; reason: string };

export type ProductSourcePredicate = (
  relPath: string,
  source: string,
) => string | false;

export type StaticImportGraphNode = {
  localDeps: string[];
  externalDeps: string[];
};

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

export function walkTsFilesFromRoots(
  roots: readonly string[],
  rootDir: string = POLICY_SCAN_ROOT,
): string[] {
  const out: string[] = [];
  for (const root of roots) {
    walkTsFiles(join(rootDir, root), out);
  }
  return out;
}

/** Absolute paths under the sole product policy roots. */
export function walkProductTsFiles(
  rootDir: string = POLICY_SCAN_ROOT,
): string[] {
  const out: string[] = [];
  for (const root of PRODUCT_POLICY_SCAN_ROOTS) {
    walkTsFiles(join(rootDir, root), out);
  }
  return out;
}

/** Absolute paths for commercial-ABI enumeration ownership scans. */
export function walkCommercialAbiEnumerationTsFiles(
  rootDir: string = POLICY_SCAN_ROOT,
): string[] {
  const out: string[] = [];
  for (const root of COMMERCIAL_ABI_ENUMERATION_SCAN_ROOTS) {
    walkTsFiles(join(rootDir, root), out);
  }
  for (const rel of COMMERCIAL_ABI_ENUMERATION_ROOT_FILES) {
    out.push(join(rootDir, rel));
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

const STATIC_IMPORT_RE =
  /\bimport\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']|\bexport\s+(?:type\s+)?(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

export function extractStaticImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const matches: string[] = [];
  for (const match of stripped.matchAll(STATIC_IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) matches.push(spec);
  }
  return matches;
}

function packageNameFromSpecifier(specifier: string): string | null {
  if (specifier.startsWith("node:")) return null;
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  const [name] = specifier.split("/");
  if (!name || builtinModules.includes(name)) return null;
  return name;
}

function resolveRepoModuleSpecifier(
  fromRel: string,
  specifier: string,
  rootDir: string,
): string | null {
  let candidateBase: string | null = null;
  if (specifier.startsWith("@/")) {
    candidateBase = specifier.slice(2);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    candidateBase = path
      .normalize(path.join(path.dirname(fromRel), specifier))
      .replace(/\\/g, "/");
  } else {
    return null;
  }

  const candidates = [
    candidateBase,
    `${candidateBase}.ts`,
    `${candidateBase}.tsx`,
    `${candidateBase}/index.ts`,
    `${candidateBase}/index.tsx`,
  ];
  for (const rel of candidates) {
    if (existsSync(join(rootDir, rel))) return rel;
  }
  return null;
}

export function buildStaticImportGraph(
  roots: readonly string[],
  rootDir: string = POLICY_SCAN_ROOT,
): Map<string, StaticImportGraphNode> {
  const graph = new Map<string, StaticImportGraphNode>();
  const files = walkTsFilesFromRoots(roots, rootDir);
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    const localDeps: string[] = [];
    const externalDeps = new Set<string>();
    for (const specifier of extractStaticImportSpecifiers(source)) {
      const local = resolveRepoModuleSpecifier(rel, specifier, rootDir);
      if (local) {
        localDeps.push(local);
        continue;
      }
      const packageName = packageNameFromSpecifier(specifier);
      if (packageName) externalDeps.add(packageName);
    }
    graph.set(rel, {
      localDeps: [...new Set(localDeps)].sort(),
      externalDeps: [...externalDeps].sort(),
    });
  }
  return graph;
}

type ReachabilityOptions = {
  rootDir?: string;
  startRoots?: readonly string[];
  graphRoots?: readonly string[];
  owners?: readonly string[];
};

function resolvePackageRootDir(
  packageName: string,
  rootDir: string,
): string | null {
  try {
    const packageJsonPath = existsSync(join(rootDir, "package.json"))
      ? join(rootDir, "package.json")
      : join(POLICY_SCAN_ROOT, "package.json");
    const resolver = createRequire(packageJsonPath);
    const entry = resolver.resolve(packageName);
    let current = path.dirname(entry);
    while (true) {
      const pkg = join(current, "package.json");
      if (existsSync(pkg)) {
        try {
          const json = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
          if (json.name === packageName) return current;
        } catch {
          // Keep walking upward until the package root.
        }
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  } catch {
    return null;
  }
}

function packageDependencies(
  packageName: string,
  rootDir: string,
): readonly string[] {
  const pkgRoot = resolvePackageRootDir(packageName, rootDir);
  if (!pkgRoot) return [];
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ].sort();
  } catch {
    return [];
  }
}

export function traceStaticReachabilityToPackages(
  bannedPackages: readonly string[],
  options?: ReachabilityOptions,
): ProductSourceHit[] {
  const rootDir = options?.rootDir ?? POLICY_SCAN_ROOT;
  const owners = new Set((options?.owners ?? []).map((p) => p.replace(/\\/g, "/")));
  const graph = buildStaticImportGraph(
    options?.graphRoots ?? PRODUCT_GRAPH_SCAN_ROOTS,
    rootDir,
  );
  const hits: ProductSourceHit[] = [];
  const banned = new Set(bannedPackages);
  for (const file of walkTsFilesFromRoots(
    options?.startRoots ?? PRODUCT_POLICY_SCAN_ROOTS,
    rootDir,
  )) {
    const startRel = relative(rootDir, file).replace(/\\/g, "/");
    if (owners.has(startRel)) continue;
    const queue: Array<{ kind: "file" | "pkg"; name: string; path: string[] }> = [
      { kind: "file", name: startRel, path: [startRel] },
    ];
    const seen = new Set<string>([`file:${startRel}`]);
    let foundPath: string[] | null = null;

    while (queue.length > 0 && !foundPath) {
      const current = queue.shift()!;
      if (current.kind === "file") {
        const node = graph.get(current.name);
        if (!node) continue;
        for (const dep of node.localDeps) {
          const key = `file:${dep}`;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ kind: "file", name: dep, path: [...current.path, dep] });
        }
        for (const dep of node.externalDeps) {
          if (banned.has(dep)) {
            foundPath = [...current.path, dep];
            break;
          }
          const key = `pkg:${dep}`;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ kind: "pkg", name: dep, path: [...current.path, dep] });
        }
        continue;
      }

      for (const dep of packageDependencies(current.name, rootDir)) {
        if (banned.has(dep)) {
          foundPath = [...current.path, dep];
          break;
        }
        const key = `pkg:${dep}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ kind: "pkg", name: dep, path: [...current.path, dep] });
      }
    }

    if (foundPath) {
      hits.push({
        path: startRel,
        reason: `static import reachability to banned Solana SDK (${foundPath.join(" -> ")})`,
      });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Scan product sources. `owners` paths are skipped (normalized `/`).
 * Predicate returns a reason string when the file violates, else false.
 */
export function scanProductSources(
  predicate: ProductSourcePredicate,
  options?: {
    owners?: readonly string[];
    rootDir?: string;
  },
): ProductSourceHit[] {
  const rootDir = options?.rootDir ?? POLICY_SCAN_ROOT;
  const owners = new Set(
    (options?.owners ?? []).map((p) => p.replace(/\\/g, "/")),
  );
  const violations: ProductSourceHit[] = [];
  for (const file of walkProductTsFiles(rootDir)) {
    const rel = relative(rootDir, file).replace(/\\/g, "/");
    if (owners.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    const reason = predicate(rel, source);
    if (reason) violations.push({ path: rel, reason });
  }
  return violations;
}

/**
 * Scan commercial-ABI enumeration surfaces (product + src + scripts +
 * ponder.config.ts). Same owner-skip / predicate contract as scanProductSources.
 */
export function scanCommercialAbiEnumerationSources(
  predicate: ProductSourcePredicate,
  options?: {
    owners?: readonly string[];
    rootDir?: string;
  },
): ProductSourceHit[] {
  const rootDir = options?.rootDir ?? POLICY_SCAN_ROOT;
  const owners = new Set(
    (options?.owners ?? []).map((p) => p.replace(/\\/g, "/")),
  );
  const violations: ProductSourceHit[] = [];
  for (const file of walkCommercialAbiEnumerationTsFiles(rootDir)) {
    const rel = relative(rootDir, file).replace(/\\/g, "/");
    if (owners.has(rel)) continue;
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const reason = predicate(rel, source);
    if (reason) violations.push({ path: rel, reason });
  }
  return violations;
}
