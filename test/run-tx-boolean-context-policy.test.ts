/**
 * runTx result must not be used in boolean context — only `result.ok` / `!result.ok`.
 * In-memory plant via mkdtemp; never mutates live product tree.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_ROOTS = ["components", "hooks"] as const;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTsFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function countRunTxCalls(source: string): number {
  const matches = source.match(/\brunTx\s*\(/g);
  return matches?.length ?? 0;
}

function runTxResultBindings(source: string): string[] {
  const bindings: string[] = [];
  const re =
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?runTx\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) != null) {
    bindings.push(m[1]!);
  }
  return bindings;
}

function findRunTxBooleanViolations(
  relPath: string,
  source: string,
): string[] {
  const violations: string[] = [];
  for (const name of runTxResultBindings(source)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const ifRe = new RegExp(
      `if\\s*\\(\\s*(!?)\\s*${escaped}\\s*\\)`,
      "g",
    );
    let im: RegExpExecArray | null;
    while ((im = ifRe.exec(source)) != null) {
      violations.push(
        `${relPath}: if (${im[1] ?? ""}${name}) — use ${name}.ok`,
      );
    }

    const whileRe = new RegExp(
      `while\\s*\\(\\s*(!?)\\s*${escaped}\\s*\\)`,
      "g",
    );
    while ((im = whileRe.exec(source)) != null) {
      violations.push(
        `${relPath}: while (${im[1] ?? ""}${name}) — use ${name}.ok`,
      );
    }

    const andRe = new RegExp(`\\b${escaped}\\s*&&`, "g");
    if (andRe.test(source)) {
      violations.push(`${relPath}: ${name} && — use ${name}.ok`);
    }

    const orRe = new RegExp(`\\b${escaped}\\s*\\|`, "g");
    if (orRe.test(source)) {
      violations.push(`${relPath}: ${name} || — use ${name}.ok`);
    }

    const ternaryRe = new RegExp(`\\b${escaped}\\s*\\?`, "g");
    if (ternaryRe.test(source)) {
      violations.push(`${relPath}: ${name} ? — use ${name}.ok ?`);
    }

    const boolRe = new RegExp(`Boolean\\s*\\(\\s*${escaped}\\s*\\)`, "g");
    if (boolRe.test(source)) {
      violations.push(`${relPath}: Boolean(${name}) — use ${name}.ok`);
    }
  }
  return violations;
}

function scanRunTxBooleanPolicy(rootDir: string): {
  runTxCallCount: number;
  violations: string[];
} {
  let runTxCallCount = 0;
  const violations: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(rootDir, scanRoot);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const file of walkTsFiles(abs)) {
      const rel = path.relative(rootDir, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      runTxCallCount += countRunTxCalls(source);
      violations.push(...findRunTxBooleanViolations(rel, source));
    }
  }
  return { runTxCallCount, violations };
}

describe("run-tx-boolean-context-policy", () => {
  it("live components/hooks: runTx call count matches scan; no boolean context on bindings", () => {
    const { runTxCallCount, violations } = scanRunTxBooleanPolicy(ROOT);
    assert.ok(runTxCallCount > 0, "must find runTx call sites in components/hooks");

    let measured = 0;
    for (const scanRoot of SCAN_ROOTS) {
      for (const file of walkTsFiles(path.join(ROOT, scanRoot))) {
        measured += countRunTxCalls(readFileSync(file, "utf8"));
      }
    }
    assert.equal(
      runTxCallCount,
      measured,
      "scanned runTx( count must equal measured total both directions",
    );
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("constructed plant: if (result) is red; if (!result.ok) is green", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-tx-bool-plant-"));
    const components = path.join(dir, "components");
    mkdirSync(components, { recursive: true });

    const badPath = path.join(components, "bad-panel.tsx");
    writeFileSync(
      badPath,
      `
export function BadPanel() {
  const result = await runTx(async () => "0x1");
  if (result) return null;
  return null;
}
`,
    );
    const badScan = scanRunTxBooleanPolicy(dir);
    assert.equal(badScan.runTxCallCount, 1);
    assert.ok(
      badScan.violations.some((v) => v.includes("if (result)")),
      "plant must trip boolean-context detector",
    );

    writeFileSync(
      badPath,
      `
export function BadPanel() {
  const result = await runTx(async () => "0x1");
  if (!result.ok) return null;
  return result.outcome;
}
`,
    );
    const goodScan = scanRunTxBooleanPolicy(dir);
    assert.deepEqual(goodScan.violations, []);
  });
});
