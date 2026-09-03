/**
 * Sole product ownership-policy scanner (S8-1-fix).
 * One root set for every place product code can live; policies supply only
 * a violation predicate (+ optional owner allowlist).
 *
 * Commercial-ABI enumeration also walks src/ + scripts/ + ponder.config.ts —
 * product roots alone miss those collection builders.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
