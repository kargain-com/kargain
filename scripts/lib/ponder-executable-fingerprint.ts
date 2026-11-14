/**
 * Sole owner of the two Ponder identities (ADR 0016 §b), computed from one
 * graph walk over a given tree (the image's own `/app` on the deploy machine):
 *
 * - Indexing identity — the static-import closure of ponder.config.ts,
 *   ponder.schema.ts and every indexing-glob file, plus Dockerfile.ponder,
 *   pnpm-lock.yaml and the runtime slice of package.json. With registry-only
 *   indexing (§a) it covers every input of Ponder's build_id and all code
 *   reachable from indexing handlers. Its first 40 hex name the schema.
 * - Executable identity — the indexing files plus the src/api/index.ts closure
 *   and docker-compose.yml. Equal executable → nothing starts.
 *
 * Neither equals or predicts build_id. Indexing files come from the
 * indexing-glob owner; there is no second walk of src/.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { listPonderIndexingGlob } from "./ponder-indexing-glob.js";
import { extractStaticImportSpecifiers } from "./static-import-specifiers.js";

/** Config and schema sit outside the indexing glob. */
export const PONDER_INDEXING_FIXED_ENTRIES = [
  "ponder.config.ts",
  "ponder.schema.ts",
] as const;

export const PONDER_API_ENTRY = "src/api/index.ts" as const;

export const PONDER_INDEXING_ARTIFACTS = [
  "Dockerfile.ponder",
  "pnpm-lock.yaml",
] as const;

export const PONDER_EXECUTABLE_ARTIFACTS = [
  ...PONDER_INDEXING_ARTIFACTS,
  "docker-compose.yml",
] as const;

export type PackageRuntimeSlice = {
  dependencies: Record<string, string>;
  packageManager: string | null;
  patchedDependencies: Record<string, string>;
  ponderStart: string | null;
};

export type PonderIdentityFile = {
  path: string;
  sha256: string;
};

export type PonderIdentityPayload = {
  files: PonderIdentityFile[];
  packageRuntime: PackageRuntimeSlice;
};

export type PonderGraph = {
  /** Static-import closure of the indexing entries. */
  indexing: string[];
  /** Static-import closure of the indexing entries and the API entry. */
  executable: string[];
};

export type PonderIdentities = {
  indexing: { digest: string; payload: PonderIdentityPayload };
  executable: { digest: string; payload: PonderIdentityPayload };
};

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

export function digestPonderIdentityPayload(
  payload: PonderIdentityPayload,
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

function isLocalSpecifier(spec: string): boolean {
  return (
    spec.startsWith("@/") ||
    spec.startsWith("./") ||
    spec.startsWith("../")
  );
}

function resolveLocalImport(
  fromFile: string,
  spec: string,
  root: string,
  planted?: Map<string, string>,
): string | null {
  if (spec.startsWith("@/")) {
    return tryResolveFile(join(root, spec.slice(2)), root, planted);
  }
  if (!(spec.startsWith("./") || spec.startsWith("../"))) return null;
  const base = resolve(dirname(fromFile), spec);
  return tryResolveFile(base, root, planted);
}

function isReadableFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Candidate exists on disk or (for planted graphs) as a key in fileContents. */
function candidateExists(
  abs: string,
  root: string,
  planted?: Map<string, string>,
): boolean {
  if (planted) {
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (planted.has(rel)) return true;
  }
  return isReadableFile(abs);
}

/**
 * TypeScript ESM: a relative/@/ specifier ending in .js/.mjs/.cjs resolves to
 * the .ts/.mts/.cts source when that file exists, before the literal file.
 */
function tryResolveFile(
  base: string,
  root: string,
  planted?: Map<string, string>,
): string | null {
  const tsEsmRemap: string[] = [];
  if (base.endsWith(".mjs")) {
    tsEsmRemap.push(`${base.slice(0, -".mjs".length)}.mts`);
  } else if (base.endsWith(".cjs")) {
    tsEsmRemap.push(`${base.slice(0, -".cjs".length)}.cts`);
  } else if (base.endsWith(".js")) {
    tsEsmRemap.push(`${base.slice(0, -".js".length)}.ts`);
  }

  const candidates = [
    ...tsEsmRemap,
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
    if (candidateExists(c, root, planted)) return c;
  }
  return null;
}

function ponderIndexingEntries(root: string): string[] {
  const indexing = listPonderIndexingGlob(root);
  return [
    ...new Set<string>([...PONDER_INDEXING_FIXED_ENTRIES, ...indexing]),
  ].sort();
}

export type PonderGraphOptions = {
  indexingEntries?: readonly string[];
  apiEntries?: readonly string[];
  /** rel path → source text; when set, only these + resolved locals are walked */
  fileContents?: Map<string, string>;
};

function readSource(
  root: string,
  rel: string,
  planted: Map<string, string> | undefined,
): string {
  if (planted) {
    const text = planted.get(rel);
    if (text === undefined) {
      throw new Error(`Ponder identity entry resolves to no file: ${rel}`);
    }
    return text;
  }
  const abs = join(root, rel);
  if (!isReadableFile(abs)) {
    throw new Error(`Ponder identity entry resolves to no file: ${rel}`);
  }
  return readFileSync(abs, "utf8");
}

function closureOf(
  entries: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const next of edges.get(rel) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return [...seen].sort();
}

/**
 * One walk of static imports from the indexing entries and the API entry.
 * Each file is read once; both closures are reachability over the same edges.
 * An entry that resolves to no file throws. Relative and `@/` imports that
 * resolve to no file throw. Bare package specifiers stay outside the graph.
 */
export function collectPonderGraph(
  root: string,
  opts?: PonderGraphOptions,
): PonderGraph {
  const normalize = (rel: string) => rel.replace(/\\/g, "/");
  const indexingEntries = (
    opts?.indexingEntries ?? ponderIndexingEntries(root)
  ).map(normalize);
  const apiEntries = (opts?.apiEntries ?? [PONDER_API_ENTRY]).map(normalize);
  if (indexingEntries.length === 0) {
    throw new Error("Ponder indexing entries are empty");
  }
  const planted = opts?.fileContents;

  const edges = new Map<string, string[]>();
  const queue = [...indexingEntries, ...apiEntries];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (edges.has(rel)) continue;
    const source = readSource(root, rel, planted);
    const out: string[] = [];
    for (const spec of extractStaticImportSpecifiers(source)) {
      if (!isLocalSpecifier(spec)) continue;
      const resolved = resolveLocalImport(join(root, rel), spec, root, planted);
      if (!resolved) {
        throw new Error(
          `Unresolved local import ${JSON.stringify(spec)} from ${rel}`,
        );
      }
      const nextRel = normalize(relative(root, resolved));
      // Planted graphs only follow files present in the map.
      if (planted && !planted.has(nextRel)) continue;
      out.push(nextRel);
      if (!edges.has(nextRel)) queue.push(nextRel);
    }
    edges.set(rel, out);
  }

  return {
    indexing: closureOf(indexingEntries, edges),
    executable: closureOf([...indexingEntries, ...apiEntries], edges),
  };
}

/** Indexing files absent from the executable set — empty for a sound pair. */
export function indexingFilesMissingFromExecutable(
  indexing: PonderIdentityPayload,
  executable: PonderIdentityPayload,
): string[] {
  const exec = new Set(executable.files.map((f) => f.path));
  return indexing.files.map((f) => f.path).filter((p) => !exec.has(p));
}

export type PonderIdentitiesOptions = PonderGraphOptions & {
  packageJson?: Parameters<typeof packageRuntimeSlice>[0];
  artifactContents?: Map<string, string>;
};

export function computePonderIdentities(
  root: string,
  opts?: PonderIdentitiesOptions,
): PonderIdentities {
  const graph = collectPonderGraph(root, opts);

  const fileOf = (rel: string): PonderIdentityFile => {
    let body: string | Buffer;
    if (opts?.fileContents?.has(rel)) {
      body = opts.fileContents.get(rel)!;
    } else if (opts?.artifactContents?.has(rel)) {
      body = opts.artifactContents.get(rel)!;
    } else {
      body = readFileSync(join(root, rel));
    }
    return { path: rel, sha256: sha256Bytes(body) };
  };

  const pkg =
    opts?.packageJson ??
    (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Parameters<
      typeof packageRuntimeSlice
    >[0]);
  const packageRuntime = packageRuntimeSlice(pkg);

  const payloadOf = (
    graphRels: readonly string[],
    artifacts: readonly string[],
  ): PonderIdentityPayload => ({
    files: [...new Set([...graphRels, ...artifacts])].sort().map(fileOf),
    packageRuntime,
  });

  const indexing = payloadOf(graph.indexing, PONDER_INDEXING_ARTIFACTS);
  const executable = payloadOf(graph.executable, PONDER_EXECUTABLE_ARTIFACTS);
  const missing = indexingFilesMissingFromExecutable(indexing, executable);
  if (missing.length > 0) {
    throw new Error(
      `Ponder executable set lacks indexing files: ${missing.join(", ")}`,
    );
  }
  return {
    indexing: { digest: digestPonderIdentityPayload(indexing), payload: indexing },
    executable: {
      digest: digestPonderIdentityPayload(executable),
      payload: executable,
    },
  };
}