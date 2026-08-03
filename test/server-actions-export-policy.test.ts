import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Next.js Turbopack: every export from a `"use server"` module must be an
 * async Server Action. Sync helpers and type re-exports break `next build`
 * (Vercel deploy). Pure parse / types belong in `lib/`, not action files.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = [
  path.join(ROOT, "app"),
  path.join(ROOT, "components"),
  path.join(ROOT, "hooks"),
  path.join(ROOT, "lib"),
] as const;

const PARSE_OWNER = path.join(ROOT, "lib/verifier/parse-directory-entry.ts");
const VERIFIER_DIRECTORY_ACTION = path.join(ROOT, "app/actions/verifier-directory.ts");

const USE_SERVER_DIRECTIVE = /^\s*["']use server["']\s*;/m;

/** Sync function export — the class that failed Vercel dpl_5rYE… */
const EXPORT_SYNC_FUNCTION = /^\s*export\s+function\s+\w+/m;

/** Named type re-export — Turbopack treats as missing runtime export. */
const EXPORT_TYPE_REEXPORT = /^\s*export\s+type\s*\{/m;

const EXPORT_VALUE_REEXPORT = /^\s*export\s+(?!type\s|async\s+function\s|function\s|interface\s|const\s|class\s|default\s|enum\s)\{/m;

const EXPORT_CLASS = /^\s*export\s+class\s+/m;
const EXPORT_DEFAULT = /^\s*export\s+default\s+/m;
const EXPORT_CONST = /^\s*export\s+const\s+/m;
const EXPORT_ENUM = /^\s*export\s+enum\s+/m;

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...listTsFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function hasUseServerDirective(text: string): boolean {
  return USE_SERVER_DIRECTIVE.test(stripComments(text));
}

type Violation = { file: string; rule: string };

function collectExportViolations(file: string, text: string): Violation[] {
  const body = stripComments(text);
  const rel = path.relative(ROOT, file);
  const out: Violation[] = [];
  if (EXPORT_SYNC_FUNCTION.test(body)) {
    out.push({ file: rel, rule: "export function (must be export async function)" });
  }
  if (EXPORT_TYPE_REEXPORT.test(body)) {
    out.push({ file: rel, rule: "export type { … } re-export (define types in lib/)" });
  }
  if (EXPORT_VALUE_REEXPORT.test(body)) {
    out.push({ file: rel, rule: "export { … } value re-export" });
  }
  if (EXPORT_CLASS.test(body)) out.push({ file: rel, rule: "export class" });
  if (EXPORT_DEFAULT.test(body)) out.push({ file: rel, rule: "export default" });
  if (EXPORT_CONST.test(body)) out.push({ file: rel, rule: "export const" });
  if (EXPORT_ENUM.test(body)) out.push({ file: rel, rule: "export enum" });
  return out;
}

describe("server actions export policy", () => {
  it("allows only async function (+ local type/interface) exports in use server modules", () => {
    const violations: string[] = [];
    const scanned: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        const text = fs.readFileSync(file, "utf8");
        if (!hasUseServerDirective(text)) continue;
        scanned.push(path.relative(ROOT, file));
        for (const v of collectExportViolations(file, text)) {
          violations.push(`${v.file}: ${v.rule}`);
        }
      }
    }
    assert.ok(scanned.length > 0, "expected at least one use server module");
    assert.ok(
      scanned.includes("app/actions/verifier-directory.ts"),
      "verifier-directory action must be scanned",
    );
    assert.deepEqual(violations, []);
  });

  it("owns directory row parse in lib/verifier/parse-directory-entry.ts", () => {
    assert.ok(fs.existsSync(PARSE_OWNER), "parse owner missing");
    const owner = fs.readFileSync(PARSE_OWNER, "utf8");
    assert.match(owner, /export function parseVerifierDirectoryEntry/);
    assert.match(owner, /export type VerifierDirectoryEntry/);

    const action = fs.readFileSync(VERIFIER_DIRECTORY_ACTION, "utf8");
    assert.match(action, /["']use server["']/);
    assert.doesNotMatch(
      action,
      /export\s+(async\s+)?function\s+parseVerifierDirectoryEntry/,
    );
    assert.doesNotMatch(action, /export\s+type\s+\{/);
    assert.match(
      action,
      /from\s+["']@\/lib\/verifier\/parse-directory-entry["']/,
    );
  });

  it("forbids importing parseVerifierDirectoryEntry from app/actions", () => {
    const violations: string[] = [];
    const importFromActions =
      /import\s*\{[^}]*\bparseVerifierDirectoryEntry\b[^}]*\}\s*from\s*["']@\/app\/actions\/verifier-directory["']|import\s*\{[^}]*\bparseVerifierDirectoryEntry\b[^}]*\}\s*from\s*["'][^"']*app\/actions\/verifier-directory[^"']*["']/;
    const dirs = [...SCAN_DIRS, path.join(ROOT, "test")];
    for (const dir of dirs) {
      for (const file of listTsFiles(dir)) {
        if (file === VERIFIER_DIRECTORY_ACTION) continue;
        if (file.endsWith("server-actions-export-policy.test.ts")) continue;
        const text = fs.readFileSync(file, "utf8");
        if (importFromActions.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });

  it("imports VerifierDirectoryEntry from lib, not from the server action", () => {
    const violations: string[] = [];
    const fromAction =
      /import\s+(?:type\s+)?(?:\{[^}]*\bVerifierDirectoryEntry\b[^}]*\}|\*\s+as\s+\w+)\s*from\s*["']@\/app\/actions\/verifier-directory["']/;
    for (const dir of SCAN_DIRS) {
      for (const file of listTsFiles(dir)) {
        if (file === VERIFIER_DIRECTORY_ACTION) continue;
        const text = stripComments(fs.readFileSync(file, "utf8"));
        if (fromAction.test(text)) {
          violations.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(violations, []);
  });
});
