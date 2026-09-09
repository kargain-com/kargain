/**
 * Sole owner of the Ponder *executable* fingerprint — what the container must
 * run (import graph from process entries + image/runtime deps). Answers:
 * "must we recreate the production container?"
 *
 * Never derived from the identity fingerprint. Identity warns about reindex;
 * executable alone gates restart.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const PONDER_EXECUTABLE_ENTRIES = [
  "ponder.config.ts",
  "ponder.schema.ts",
  "src/index.ts",
  "src/api/index.ts",
] as const;

export const PONDER_EXECUTABLE_ARTIFACTS = [
  "Dockerfile.ponder",
  "docker-compose.yml",
  "pnpm-lock.yaml",
] as const;

/** Paths under the import graph that never force a Ponder recreate. */
export const PONDER_EXECUTABLE_GRAPH_EXCLUDES = ["src/svm-ingest/"] as const;

export type PackageRuntimeSlice = {
  dependencies: Record<string, string>;
  packageManager: string | null;
  patchedDependencies: Record<string, string>;
  ponderStart: string | null;
};

export type PonderExecutableFile = {
  path: string;
  sha256: string;
};

export type PonderExecutablePayload = {
  files: PonderExecutableFile[];
  packageRuntime: PackageRuntimeSlice;
};

const STATIC_IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\)/g;

function sha256Bytes(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}

export function digestPonderExecutablePayload(
  payload: PonderExecutablePayload,
): string {
  return sha256Bytes(JSON.stringify(sortKeys(payload)));
}

/**
 * Runtime-affecting slice of package.json. scripts.test:* and other non-runtime
 * keys are intentionally omitted so test-membership edits do not recreate.
 */
export function packageRuntimeSlice(pkg: {
  dependencies?: Record<string, string>;
  packageManager?: string;
  pnpm?: { patchedDependencies?: Record<string, string> };
  scripts?: Record<string, string>;
}): PackageRuntimeSlice {
  return {
    dependencies: { ...(pkg.dependencies ?? {}) },
    packageManager: pkg.packageManager ?? null,
    patchedDependencies: { ...(pkg.pnpm?.patchedDependencies ?? {}) },
    ponderStart: pkg.scripts?.["ponder:start"] ?? null,
  };
}

function isExcludedGraphPath(rel: string): boolean {
  const normalized = rel.replace(/\\/g, "/");
  for (const prefix of PONDER_EXECUTABLE_GRAPH_EXCLUDES) {
    if (normalized === prefix || normalized.startsWith(prefix)) return true;
  }
  return false;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractStaticSpecs(source: string): string[] {
  const specs: string[] = [];
  const stripped = stripComments(source);
  for (const match of stripped.matchAll(STATIC_IMPORT_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveLocalImport(
  fromFile: string,
  spec: string,
  root: string,
): string | null {
  if (spec.startsWith("@/")) {
    return tryResolveFile(join(root, spec.slice(2)));
  }
  if (!(spec.startsWith("./") || spec.startsWith("../"))) return null;
  const base = resolve(dirname(fromFile), spec);
  return tryResolveFile(base);
}

function isReadableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function tryResolveFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.mts`,
    join(base, "index.ts"),
    join(base, "index.js"),
  ];
  for (const c of candidates) {
    if (isReadableFile(c)) return c;
  }
  return null;
}

/**
 * Walk static imports from process entries. Excludes src/svm-ingest/**.
 * Injectable fileContents map lets tests plant a graph without touching live src.
 */
export function collectPonderExecutableGraphFiles(
  root: string,
  opts?: {
    entries?: readonly string[];
    /** rel path → source text; when set, only these + resolved locals are walked */
    fileContents?: Map<string, string>;
  },
): string[] {
  const entries = opts?.entries ?? PONDER_EXECUTABLE_ENTRIES;
  const visited = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const rel = queue.shift()!.replace(/\\/g, "/");
    if (visited.has(rel)) continue;
    if (isExcludedGraphPath(rel)) continue;
    visited.add(rel);

    let source: string | undefined;
    if (opts?.fileContents) {
      source = opts.fileContents.get(rel);
      if (source === undefined) continue;
    } else {
      const abs = join(root, rel);
      if (!existsSync(abs)) continue;
      source = readFileSync(abs, "utf8");
    }

    for (const spec of extractStaticSpecs(source)) {
      const absFrom = join(root, rel);
      const resolved = resolveLocalImport(absFrom, spec, root);
      if (!resolved) continue;
      const nextRel = relative(root, resolved).replace(/\\/g, "/");
      if (isExcludedGraphPath(nextRel)) continue;
      if (opts?.fileContents && !opts.fileContents.has(nextRel)) {
        // Planted graphs only follow files present in the map.
        continue;
      }
      if (!visited.has(nextRel)) queue.push(nextRel);
    }
  }

  return [...visited].sort();
}

export function buildPonderExecutablePayload(
  root: string,
  opts?: {
    entries?: readonly string[];
    fileContents?: Map<string, string>;
    packageJson?: Parameters<typeof packageRuntimeSlice>[0];
    artifactContents?: Map<string, string>;
  },
): PonderExecutablePayload {
  const graphRels = collectPonderExecutableGraphFiles(root, {
    entries: opts?.entries,
    fileContents: opts?.fileContents,
  });

  const artifactRels = [...PONDER_EXECUTABLE_ARTIFACTS];
  const allRels = [...new Set([...graphRels, ...artifactRels])].sort();

  const files: PonderExecutableFile[] = allRels.map((rel) => {
    let body: string | Buffer;
    if (opts?.fileContents?.has(rel)) {
      body = opts.fileContents.get(rel)!;
    } else if (opts?.artifactContents?.has(rel)) {
      body = opts.artifactContents.get(rel)!;
    } else {
      body = readFileSync(join(root, rel));
    }
    return { path: rel, sha256: sha256Bytes(body) };
  });

  const pkg =
    opts?.packageJson ??
    (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Parameters<
      typeof packageRuntimeSlice
    >[0]);

  return {
    files,
    packageRuntime: packageRuntimeSlice(pkg),
  };
}

export function computePonderExecutableFingerprint(
  root: string,
  opts?: Parameters<typeof buildPonderExecutablePayload>[1],
): string {
  return digestPonderExecutablePayload(buildPonderExecutablePayload(root, opts));
}
