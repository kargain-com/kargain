/**
 * Sole owner: which suites `pnpm test` (Hardhat) may discover and run.
 *
 * Hardhat 3's default `paths.tests.nodejs = "test"` recursively loads every
 * `.ts` under `test/` — including product policy suites that belong to named
 * `test:*` gates. This module is the only enumeration Hardhat is allowed to
 * run; the runner passes the list as explicit `testFiles`.
 *
 * Commerce contract suites may also appear in `test:verify` (WORKING-METHOD §8
 * fold). Local E2E (`test/e2e-local.test.ts`) imports Hardhat but is owned by
 * `test:e2e` only — never by this list.
 */

import fs from "node:fs";
import path from "node:path";

/** Relative paths from repo root — in-process Hardhat / edr suites only. */
export const HARDHAT_NATIVE_SUITES = [
  "test/KarPassportBridge.test.ts",
  "test/KarPassportBridgeGateway.test.ts",
  "test/KarPassportEncumbrance.test.ts",
  "test/KarPassportV2.test.ts",
  "test/Timelock48h.test.ts",
  "test/ascending/AscendingConsignment.test.ts",
  "test/bonded-challenge/BondedChallenge.test.ts",
  "test/claimable-payouts-sink-gas.test.ts",
  "test/consignment-base/ConsignmentBase.test.ts",
  "test/fixed-price/FixedPriceConsignment.test.ts",
  "test/kargain.contracts.test.ts",
  "test/mandate-recall/MandateRecall.test.ts",
  "test/nuclear-rehearsal.test.ts",
] as const;

export type HardhatNativeSuite = (typeof HARDHAT_NATIVE_SUITES)[number];

/** E2E imports Hardhat but is gated by `test:e2e` (needs a live node). */
export const HARDHAT_E2E_SUITE = "test/e2e-local.test.ts" as const;

const TEST_FILE_RE = /test\/[^\s]+\.test\.ts/g;

/** True when a source line is a Hardhat import (ignores string/plant mentions). */
export function isHardhatNativeSource(source: string): boolean {
  for (const line of source.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("import ") && !t.startsWith("import\t")) continue;
    if (
      /\bfrom\s+["']hardhat["']/.test(t) ||
      /^import\s+hardhat\b/.test(t) ||
      /["']@nomicfoundation\/hardhat/.test(t)
    ) {
      return true;
    }
  }
  return false;
}

export function isHardhatNativeSuitePath(relFromRoot: string): boolean {
  return (HARDHAT_NATIVE_SUITES as readonly string[]).includes(relFromRoot);
}

export function parseTestFilesFromScriptBody(scriptBody: string): string[] {
  return scriptBody.match(TEST_FILE_RE) ?? [];
}

/** Walk `test/` for `*.test.ts` (posix-relative `test/...`). */
export function listTestSuiteFiles(testDirAbs: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (ent.name.endsWith(".test.ts")) {
        out.push(path.relative(path.dirname(testDirAbs), abs).split(path.sep).join("/"));
      }
    }
  };
  walk(testDirAbs);
  return out.sort();
}

/** Files under `test/` whose source imports Hardhat (incl. e2e). */
export function scanHardhatImportingSuites(testDirAbs: string): string[] {
  return listTestSuiteFiles(testDirAbs).filter((rel) => {
    const abs = path.join(path.dirname(testDirAbs), rel);
    return isHardhatNativeSource(fs.readFileSync(abs, "utf8"));
  });
}

export type HardhatSuiteHole =
  | { kind: "declared_not_hardhat_import"; file: string }
  | { kind: "hardhat_import_undeclared"; file: string }
  | { kind: "unreachable"; file: string };

/**
 * Bidirectional:
 * - Declared HARDHAT_NATIVE_SUITES ≡ Hardhat-importing suites ∖ e2e
 * - Every suite file is in the Hardhat set, e2e, or some `test:*` script list
 */
export function findHardhatSuiteHoles(args: {
  testDirAbs: string;
  scripts: Record<string, string>;
}): HardhatSuiteHole[] {
  const scanned = new Set(scanHardhatImportingSuites(args.testDirAbs));
  const declared = new Set<string>(HARDHAT_NATIVE_SUITES);
  const holes: HardhatSuiteHole[] = [];

  for (const file of HARDHAT_NATIVE_SUITES) {
    if (!scanned.has(file)) {
      holes.push({ kind: "declared_not_hardhat_import", file });
    }
  }
  for (const file of scanned) {
    if (file === HARDHAT_E2E_SUITE) continue;
    if (!declared.has(file)) {
      holes.push({ kind: "hardhat_import_undeclared", file });
    }
  }

  const gated = new Set<string>();
  for (const [name, body] of Object.entries(args.scripts)) {
    if (name === "test" || !name.startsWith("test:")) continue;
    for (const f of parseTestFilesFromScriptBody(String(body))) {
      gated.add(f);
    }
  }
  gated.add(HARDHAT_E2E_SUITE);

  for (const file of listTestSuiteFiles(args.testDirAbs)) {
    if (declared.has(file) || gated.has(file)) continue;
    holes.push({ kind: "unreachable", file });
  }

  return holes.sort((a, b) => a.file.localeCompare(b.file) || a.kind.localeCompare(b.kind));
}

/** `package.json#scripts.test` must invoke the Hardhat suite runner (not bare discover-all). */
export function isHardhatTestScriptPartitioned(scriptBody: string): boolean {
  return (
    /run-hardhat-test/.test(scriptBody) &&
    !/^\s*hardhat\s+test\s*$/.test(scriptBody.trim())
  );
}
