/**
 * Forbid tests from mutating repo `deployments/` (gitignored live-deploy records).
 * Isolation must use `KARGAIN_DEPLOYMENTS_DIR` → empty temp dir, never rename/unlink/write.
 *
 * Classifies mutation *calls* via the TypeScript AST (path args only). Comments and
 * unrelated string literals that mention deployments/ do not count. Mutators and
 * join/resolve are recognised from the file's imports (any local name), not only
 * by literal identifiers like `fs` / `path`.
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

const FS_MODULES = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
]);
const PATH_MODULES = new Set(["path", "node:path"]);

type ModuleImports = {
  /** Local name → mutator base (`rm`, `unlink`, …). */
  mutatorLocals: Map<string, string>;
  /** Default/namespace locals from fs modules; value true = promises namespace. */
  fsReceivers: Map<string, boolean>;
  /** Local name → true for named join/resolve imports. */
  joinResolveLocals: Set<string>;
  /** Default/namespace locals from path modules. */
  pathReceivers: Set<string>;
};

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
    if (ts.isAwaitExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    return cur;
  }
}

function stringMentionsDeployments(text: string): boolean {
  return text.includes("deployments/");
}

function mutatorBaseFromExportName(name: string): string | null {
  const base = name.replace(/Sync$/, "");
  return MUTATOR_BASE.has(base) ? base : null;
}

function moduleSpecifierText(decl: ts.ImportDeclaration): string | null {
  const spec = decl.moduleSpecifier;
  if (ts.isStringLiteral(spec) || ts.isNoSubstitutionTemplateLiteral(spec)) {
    return spec.text;
  }
  return null;
}

function collectModuleImports(sf: ts.SourceFile): ModuleImports {
  const mutatorLocals = new Map<string, string>();
  const fsReceivers = new Map<string, boolean>();
  const joinResolveLocals = new Set<string>();
  const pathReceivers = new Set<string>();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const mod = moduleSpecifierText(stmt);
    if (!mod) continue;
    const clause = stmt.importClause;

    if (FS_MODULES.has(mod)) {
      const isPromises = mod.endsWith("/promises");
      if (clause.name) {
        fsReceivers.set(clause.name.text, isPromises);
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        fsReceivers.set(bindings.name.text, isPromises);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const exported = (el.propertyName ?? el.name).text;
          if (exported === "promises" && !isPromises) {
            // `import { promises as P } from "node:fs"` — same receiver as fs/promises.
            fsReceivers.set(el.name.text, true);
            continue;
          }
          const base = mutatorBaseFromExportName(exported);
          if (base) mutatorLocals.set(el.name.text, base);
        }
      }
    }

    if (PATH_MODULES.has(mod)) {
      if (clause.name) {
        pathReceivers.add(clause.name.text);
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        pathReceivers.add(bindings.name.text);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const exported = (el.propertyName ?? el.name).text;
          if (exported === "join" || exported === "resolve") {
            joinResolveLocals.add(el.name.text);
          }
        }
      }
    }
  }

  return { mutatorLocals, fsReceivers, joinResolveLocals, pathReceivers };
}

function isJoinOrResolveCallee(
  expr: ts.Expression,
  imports: ModuleImports,
): boolean {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    if (e.text === "join" || e.text === "resolve") return true;
    return imports.joinResolveLocals.has(e.text);
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    const name = e.name.text;
    if (name !== "join" && name !== "resolve") return false;
    const obj = unwrap(e.expression);
    if (!ts.isIdentifier(obj)) return false;
    if (obj.text === "path" || obj.text === "nodePath") return true;
    return imports.pathReceivers.has(obj.text);
  }
  return false;
}

function callArgMentionsDeployments(
  expr: ts.Expression,
  deploymentsConsts: ReadonlySet<string>,
  imports: ModuleImports,
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
  if (ts.isCallExpression(e) && isJoinOrResolveCallee(e.expression, imports)) {
    return joinOrResolveTargetsDeployments(e, deploymentsConsts, imports);
  }
  return false;
}

function joinOrResolveTargetsDeployments(
  call: ts.CallExpression,
  deploymentsConsts: ReadonlySet<string>,
  imports: ModuleImports,
): boolean {
  for (const arg of call.arguments) {
    if (callArgMentionsDeployments(arg, deploymentsConsts, imports)) return true;
  }
  return false;
}

function initializerTargetsDeployments(
  init: ts.Expression,
  deploymentsConsts: ReadonlySet<string>,
  imports: ModuleImports,
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
  if (ts.isCallExpression(e) && isJoinOrResolveCallee(e.expression, imports)) {
    return joinOrResolveTargetsDeployments(e, deploymentsConsts, imports);
  }
  if (ts.isIdentifier(e)) {
    return deploymentsConsts.has(e.text);
  }
  return false;
}

/** Same-file const names whose initializer statically targets repo deployments/. */
function collectDeploymentsPathConsts(
  sf: ts.SourceFile,
  imports: ModuleImports,
): Set<string> {
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
        initializerTargetsDeployments(node.initializer, names, imports)
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

function mutatorName(
  expr: ts.Expression,
  imports: ModuleImports,
): string | null {
  const e = unwrap(expr);
  if (ts.isIdentifier(e)) {
    const fromImport = imports.mutatorLocals.get(e.text);
    if (fromImport) return fromImport;
    return mutatorBaseFromExportName(e.text);
  }
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) {
    const base = mutatorBaseFromExportName(e.name.text);
    if (!base) return null;
    const obj = unwrap(e.expression);
    if (ts.isIdentifier(obj)) {
      if (
        obj.text === "fs" ||
        obj.text === "fsPromises" ||
        obj.text === "promises"
      ) {
        return base;
      }
      if (imports.fsReceivers.has(obj.text)) return base;
    }
    // fs.promises.rm / importedFs.promises.rm
    if (
      ts.isPropertyAccessExpression(obj) &&
      ts.isIdentifier(obj.name) &&
      obj.name.text === "promises"
    ) {
      const outer = unwrap(obj.expression);
      if (ts.isIdentifier(outer)) {
        if (outer.text === "fs") return base;
        const rec = imports.fsReceivers.get(outer.text);
        if (rec === false) return base;
      }
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
  const imports = collectModuleImports(sf);
  const deploymentsConsts = collectDeploymentsPathConsts(sf, imports);
  const hits: DeploymentsMutationHit[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const mutator = mutatorName(node.expression, imports);
      if (mutator) {
        for (const arg of pathArgsForMutator(mutator, [...node.arguments])) {
          if (callArgMentionsDeployments(arg, deploymentsConsts, imports)) {
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

  it('constructed: default import from node:fs/promises → fsp.rm(join(…)) is red', () => {
    const planted = [
      'import fsp from "node:fs/promises";',
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'await fsp.rm(join(ROOT, "deployments"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "rm"),
      `expected rm hit, got ${JSON.stringify(hits)}`,
    );
  });

  it('constructed: namespace import * as nfs from node:fs → nfs.rmSync(join(…)) is red', () => {
    const planted = [
      'import * as nfs from "node:fs";',
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'nfs.rmSync(join(ROOT, "deployments"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "rm"),
      `expected rm hit, got ${JSON.stringify(hits)}`,
    );
  });

  it('constructed: default path import → rmSync(p.join(…)) is red', () => {
    const planted = [
      'import p from "node:path";',
      'const ROOT = "/repo";',
      'rmSync(p.join(ROOT, "deployments"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "rm"),
      `expected rm hit, got ${JSON.stringify(hits)}`,
    );
  });

  it('constructed: named import { rmSync as del } → del(join(…)) is red', () => {
    const planted = [
      'import { rmSync as del } from "node:fs";',
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'del(join(ROOT, "deployments"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "rm"),
      `expected rm hit, got ${JSON.stringify(hits)}`,
    );
  });

  it('constructed: named import { promises as P } from node:fs → P.unlink(join(…)) is red', () => {
    const planted = [
      'import { promises as P } from "node:fs";',
      'import { join } from "node:path";',
      'const ROOT = "/repo";',
      'await P.unlink(join(ROOT, "deployments", "x.json"));',
    ].join("\n");
    const hits = findDeploymentsMutationsInSource(planted);
    assert.ok(
      hits.some((h) => h.mutator === "unlink"),
      `expected unlink hit, got ${JSON.stringify(hits)}`,
    );
  });
});
