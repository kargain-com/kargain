/**
 * Sole owner of the Ponder *executable* fingerprint — what the container must
 * run. The import graph starts at ponder.config.ts, ponder.schema.ts, every
 * path from the indexing-glob owner, and the API entry src/api/index.ts, then
 * follows static imports. Image and runtime deps are hashed with that graph.
 * Answers: "must we recreate the production container?"
 *
 * Never derived from the identity fingerprint. Identity warns about reindex;
 * executable alone gates restart. No second walk of src/ — indexing files come
 * from listPonderIndexingGlob.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { listPonderIndexingGlob } from "./ponder-indexing-glob.js";
import { extractStaticImportSpecifiers } from "./static-import-specifiers.js";

export const PONDER_EXECUTABLE_ARTIFACTS = [
  "Dockerfile.ponder",
  "docker-compose.yml",
  "pnpm-lock.yaml",
] as const;


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

/** Config, schema, and the API entry sit outside the indexing glob. */
const PONDER_EXECUTABLE_FIXED_ENTRIES = [
  "ponder.config.ts",
  "ponder.schema.ts",
  "src/api/index.ts",
] as const;

function ponderExecutableEntries(root: string): string[] {
  const indexing = listPonderIndexingGlob(root);
  for (const rel of PONDER_EXECUTABLE_FIXED_ENTRIES) {
    if (!isReadableFile(join(root, rel))) {
      throw new Error(`Ponder executable entry resolves to no file: ${rel}`);
    }
  }
  return [
    ...new Set<string>([...PONDER_EXECUTABLE_FIXED_ENTRIES, ...indexing]),
  ].sort();
}

/**
 * Walk static imports from process entries.
 * Default entries are the indexing glob plus config, schema, and the API entry.
 * Injectable fileContents map lets tests plant a graph without touching live src.
 * An entry that resolves to no file throws. Relative and `@/` imports that
 * resolve to no file throw. Bare package specifiers stay outside the graph.
 */
export function collectPonderExecutableGraphFiles(
  root: string,
  opts?: {
    entries?: readonly string[];
    /** rel path → source text; when set, only these + resolved locals are walked */
    fileContents?: Map<string, string>;
  },
): string[] {
  const entries = (opts?.entries ?? ponderExecutableEntries(root)).map((rel) =>
    rel.replace(/\\/g, "/"),
  );
  if (entries.length === 0) {
    throw new Error("Ponder executable entries are empty");
  }
  for (const rel of entries) {
    const inPlant =
      opts?.fileContents !== undefined && opts.fileContents.has(rel);
    const onDisk = opts?.fileContents === undefined && isReadableFile(join(root, rel));
    if (!inPlant && !onDisk) {
      throw new Error(`Ponder executable entry resolves to no file: ${rel}`);
    }
  }
  const visited = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const rel = queue.shift()!;
    if (visited.has(rel)) continue;
    visited.add(rel);

    let source: string;
    if (opts?.fileContents) {
      const planted = opts.fileContents.get(rel);
      if (planted === undefined) {
        throw new Error(`Ponder executable entry resolves to no file: ${rel}`);
      }
      source = planted;
    } else {
      const abs = join(root, rel);
      if (!existsSync(abs)) {
        throw new Error(`Ponder executable entry resolves to no file: ${rel}`);
      }
      source = readFileSync(abs, "utf8");
    }

    for (const spec of extractStaticImportSpecifiers(source)) {
      if (!isLocalSpecifier(spec)) continue;
      const absFrom = join(root, rel);
      const resolved = resolveLocalImport(
        absFrom,
        spec,
        root,
        opts?.fileContents,
      );
      if (!resolved) {
        throw new Error(
          `Unresolved local import ${JSON.stringify(spec)} from ${rel}`,
        );
      }
      const nextRel = relative(root, resolved).replace(/\\/g, "/");
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
