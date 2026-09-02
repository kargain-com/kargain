/**
 * Sole product ownership-policy scanner (S8-1-fix).
 * One root set for every place product code can live; policies supply only
 * a violation predicate (+ optional owner allowlist).
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
