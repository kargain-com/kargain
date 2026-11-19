/**
 * Forbid tests from mutating repo `deployments/` (gitignored live-deploy records).
 * Isolation must use `KARGAIN_DEPLOYMENTS_DIR` → empty temp dir, never rename/unlink/write.
 *
 * Classifies mutation *calls* via the TypeScript AST (path args only). Comments and
 * unrelated string literals that mention deployments/ do not count.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "test");
const SELF = "deployments-mutation-policy.test.ts";

const MUTATOR_BASE = new Set([
  "rename",
  "unlink",
  "rm",
  "rmdir",
  "writeFile",
]);

function listTestFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTestFiles(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    return cur;
  }
}

function stringMentionsDeployments(text: string): boolean {
  return text.includes("deployments/");
}

function isJoinOrResolveCallee(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    return e.text === "join" || e.text === "resolve";
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    const name = e.name.text;
    if (name !== "join" && name !== "resolve") return false;
    const obj = unwrap(e.expression);
    return ts.isIdentifier(obj) && (obj.text === "path" || obj.text === "nodePath");
  }
  return false;
}

function callArgMentionsDeployments(
  expr: ts.Expression,
  deploymentsConsts: ReadonlySet<string>,
): boolean {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return e.text === "deployments" || stringMentionsDeployments(e.text);
  }
  if (ts.isTemplateExpression(e)) {
    if (stringMentionsDeployments(e.head.text)) return true;
    for (const span of e.templateSpans) {
      if (stringMentionsDeployments(span.literal.text)) return true;
    }
    return false;
  }
  if (ts.isIdentifier(e)) {
    return deploymentsConsts.has(e.text);
  }
  if (ts.isCallExpression(e) && isJoinOrResolveCallee(e.expression)) {
    return joinOrResolveTargetsDeployments(e, deploymentsConsts);
  }
  return false;
}

function joinOrResolveTargetsDeployments(
  call: ts.CallExpression,
  deploymentsConsts: ReadonlySet<string>,
): boolean {
  for (const arg of call.arguments) {
    if (callArgMentionsDeployments(arg, deploymentsConsts)) return true;
  }
  return false;
}

function initializerTargetsDeployments(
  init: ts.Expression,
  deploymentsConsts: ReadonlySet<string>,
): boolean {
  const e = unwrap(init);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
    return stringMentionsDeployments(e.text);
  }
  if (ts.isTemplateExpression(e)) {
    if (stringMentionsDeployments(e.head.text)) return true;
    for (const span of e.templateSpans) {
      if (stringMentionsDeployments(span.literal.text)) return true;
    }
    return false;
  }
  if (ts.isCallExpression(e) && isJoinOrResolveCallee(e.expression)) {
    return joinOrResolveTargetsDeployments(e, deploymentsConsts);
  }
  if (ts.isIdentifier(e)) {
    return deploymentsConsts.has(e.text);
  }
  return false;
}

/** Same-file const names whose initializer statically targets repo deployments/. */
function collectDeploymentsPathConsts(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !names.has(node.name.text) &&
        initializerTargetsDeployments(node.initializer, names)
      ) {
        names.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return names;
}

function mutatorName(expr: ts.Expression): string | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    const base = e.text.replace(/Sync$/, "");
    return MUTATOR_BASE.has(base) ? base : null;
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    const base = e.name.text.replace(/Sync$/, "");
    if (!MUTATOR_BASE.has(base)) return null;
    const obj = unwrap(e.expression);
    if (ts.isIdentifier(obj)) {
      if (
        obj.text === "fs" ||
        obj.text === "fsPromises" ||
        obj.text === "promises"
      ) {
        return base;
      }
    }
    if (
      ts.isPropertyAccessExpression(obj) &&
      ts.isIdentifier(obj.expression) &&
      obj.expression.text === "fs" &&
      ts.isIdentifier(obj.name) &&
      obj.name.text === "promises"
    ) {
      return base;
    }
  }
  return null;
}

/** Path args: first for unlink/rm/rmdir/writeFile; first two for rename. */
function pathArgsForMutator(
  name: string,
  args: readonly ts.Expression[],
): ts.Expression[] {
  if (name === "rename") return args.slice(0, 2);
  return args.slice(0, 1);
}

export type DeploymentsMutationHit = {
  line: number;
  mutator: string;
};

/**
 * Find mutation calls whose path argument(s) statically resolve to repo
 * `deployments/`. Comments are invisible to the AST walk.
 */
export function findDeploymentsMutationsInSource(
  source: string,
  fileName = "planted.ts",
): DeploymentsMutationHit[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const deploymentsConsts = collectDeploymentsPathConsts(sf);
  const hits: DeploymentsMutationHit[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const mutator = mutatorName(node.expression);
      if (mutator) {
        for (const arg of pathArgsForMutator(mutator, [...node.arguments])) {
          if (callArgMentionsDeployments(arg, deploymentsConsts)) {
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            hits.push({ line: line + 1, mutator });
            break;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function findLiveViolations(): string[] {
  const violations: string[] = [];
  for (const file of listTestFiles(TEST_DIR)) {
    if (file.endsWith(`${path.sep}${SELF}`)) continue;
    const text = fs.readFileSync(file, "utf8");
    const hits = findDeploymentsMutationsInSource(text, path.basename(file));
    if (hits.length > 0) {
      violations.push(path.relative(ROOT, file));
    }
  }
  return violations;
}

describe("deployments mutation policy", () => {
  it("forbids rename/unlink/rm/rmdir/writeFile against deployments/ under test/", () => {
    const violations = findLiveViolations();
    assert.deepEqual(
      violations,
      [],
      `Tests must not mutate deployments/ (use KARGAIN_DEPLOYMENTS_DIR):\n${violations.join("\n")}`,
    );
  });

  it("constructed: rmSync(join(ROOT, \"deployments\", …)) is red", () => {
    const planted = [
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'rmSync(join(ROOT, "deployments", "31337.json"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "rm"),
      `expected rm hit, got ${JSON.stringify(hits)}`,
    );
  });

  it("constructed: const p = join(ROOT, \"deployments\"); unlinkSync(p) is red", () => {
    const planted = [
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'const p = join(ROOT, "deployments");',
      "unlinkSync(p);",
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "unlink"),
      `expected unlink hit, got ${JSON.stringify(hits)}`,
    );
  });

  it("constructed: comment naming deployments/31337.json plus rmSync(mkdtemp) is green", () => {
    const planted = [
      'import { mkdtempSync, rmSync } from "node:fs";',
      'import { tmpdir } from "node:os";',
      'import { join } from "node:path";',
      "/** Empty dir outside the repo — no gitignored deployments/31337.json. */",
      'const EMPTY = mkdtempSync(join(tmpdir(), "kargain-empty-"));',
      "rmSync(EMPTY, { recursive: true, force: true });",
    ].join("\n");
    assert.deepEqual(findDeploymentsMutationsInSource(planted), []);
  });
});
