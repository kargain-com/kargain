/**
 * lib/ must not import scripts/ — tsconfig excludes scripts but TypeScript still
 * typechecks transitive imports from lib/**, surfacing latent script defects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB_DIR = path.join(ROOT, "lib");

/** Value and type imports from scripts/ under lib/ (relative or @/ alias). */
const SCRIPTS_IMPORT =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["'](?:@\/scripts\/|\.\.\/)+scripts\//;

function listLibTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listLibTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function scanLibScriptsImports(): { file: string; line: number; text: string }[] {
  const violations: { file: string; line: number; text: string }[] = [];
  for (const file of listLibTsFiles(LIB_DIR)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (SCRIPTS_IMPORT.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

describe("lib scripts boundary policy", () => {
  it("lib/** does not import from scripts/ (value or type)", () => {
    const violations = scanLibScriptsImports();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.line} ${v.text}`).join("\n") ||
        "lib must not import scripts",
    );
  });

  it("constructed violation: lib importing scripts is detected", () => {
    const fixture =
      'import type { SvmDevnetEvidence } from "../../scripts/lib/load-deployment.js";\n';
    assert.match(fixture, SCRIPTS_IMPORT);
  });
});
