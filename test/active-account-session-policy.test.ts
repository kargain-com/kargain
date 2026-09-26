/**
 * S8-D session store — adapters called exactly once (ActiveAccountProvider);
 * useActiveAccount is a context read (never calls adapters).
 * Account identity is constructed once (no render-time ActiveAccount literals);
 * provider hooks never list whole `evm` / `svm` snapshots in dependency arrays.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { walkProductTsFiles } from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDER = "lib/web3/active-account-provider.tsx";
const SVM_ADAPTER = "lib/web3/svm-account-adapter.ts";
const ENTRY = "hooks/use-active-account.ts";
const VOCAB = "lib/web3/active-account.ts";
const SESSION = "lib/web3/svm-account-session.tsx";

const ADAPTER_CALLEES = new Set([
  "useEvmAccountAdapter",
  "useSvmAccountAdapter",
]);

const IDENTITY_SCOPED = [PROVIDER, SVM_ADAPTER] as const;

export type AdapterCallSite = {
  file: string;
  callee: string;
  line: number;
};

/**
 * Count `useEvmAccountAdapter` / `useSvmAccountAdapter` CallExpressions in source.
 * Shared by live scan and in-memory plants.
 */
export function extractAdapterCallSites(
  filePath: string,
  sourceText: string,
): AdapterCallSite[] {
  const kind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const sites: AdapterCallSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr) && ADAPTER_CALLEES.has(expr.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(expr.getStart(sf));
        sites.push({
          file: filePath,
          callee: expr.text,
          line: line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function countByCallee(
  sites: readonly AdapterCallSite[],
  callee: string,
): number {
  return sites.filter((s) => s.callee === callee).length;
}

function assertAdapterPlacement(sites: readonly AdapterCallSite[]): void {
  for (const site of sites) {
    assert.equal(
      site.file,
      PROVIDER,
      `adapter call outside ActiveAccountProvider (${site.file}:${site.line} ${site.callee})`,
    );
  }
  const evm = countByCallee(sites, "useEvmAccountAdapter");
  const svm = countByCallee(sites, "useSvmAccountAdapter");
  assert.equal(
    evm,
    1,
    `useEvmAccountAdapter call sites must be exactly 1 (found ${evm}: ${JSON.stringify(sites.filter((s) => s.callee === "useEvmAccountAdapter"))})`,
  );
  assert.equal(
    svm,
    1,
    `useSvmAccountAdapter call sites must be exactly 1 (found ${svm}: ${JSON.stringify(sites.filter((s) => s.callee === "useSvmAccountAdapter"))})`,
  );
}

function propName(prop: ts.ObjectLiteralElementLike): string | null {
  if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
    if (ts.isIdentifier(prop.name)) return prop.name.text;
    if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.name)) {
      return prop.name.text;
    }
  }
  return null;
}

function literalString(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * ActiveAccount-shaped object literals (status + vm, or status disconnected).
 * Shared by live scan and plants — red when found in adapter/provider render paths.
 */
export function findActiveAccountLiterals(
  filePath: string,
  sourceText: string,
): string[] {
  const kind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      let statusLit: string | null = null;
      for (const prop of node.properties) {
        const name = propName(prop);
        if (name == null) continue;
        names.add(name);
        if (
          name === "status" &&
          ts.isPropertyAssignment(prop)
        ) {
          statusLit = literalString(prop.initializer);
        }
      }
      const connectedShape =
        names.has("status") &&
        names.has("vm") &&
        names.has("address") &&
        (statusLit === "connected" || statusLit == null);
      const disconnectedShape =
        names.has("status") &&
        statusLit === "disconnected" &&
        !names.has("vm");
      if (connectedShape || disconnectedShape) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push(
          `ActiveAccount object literal in render path (${filePath}:${line + 1})`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * Whole-snapshot identifiers `evm` / `svm` in useCallback / useMemo / useEffect deps.
 */
export function findSnapshotDepsInHookArrays(
  filePath: string,
  sourceText: string,
): string[] {
  const kind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const HOOKS = new Set(["useCallback", "useMemo", "useEffect"]);
  const BANNED = new Set(["evm", "svm"]);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      HOOKS.has(node.expression.text) &&
      node.arguments.length >= 2
    ) {
      const deps = node.arguments[1];
      if (deps && ts.isArrayLiteralExpression(deps)) {
        for (const el of deps.elements) {
          if (ts.isIdentifier(el) && BANNED.has(el.text)) {
            const { line } = sf.getLineAndCharacterOfPosition(
              el.getStart(sf),
            );
            hits.push(
              `snapshot identifier "${el.text}" in ${node.expression.text} deps (${filePath}:${line + 1})`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function assertCleanIdentitySource(filePath: string, sourceText: string): void {
  const literals = findActiveAccountLiterals(filePath, sourceText);
  assert.deepEqual(
    literals,
    [],
    literals[0] ?? "ActiveAccount literal",
  );
  const deps = findSnapshotDepsInHookArrays(filePath, sourceText);
  assert.deepEqual(deps, [], deps[0] ?? "snapshot deps");
}

describe("active-account session policy (S8-D)", () => {
  it("live product tree: each adapter called exactly once in ActiveAccountProvider", () => {
    const sites: AdapterCallSite[] = [];
    for (const abs of walkProductTsFiles(ROOT)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const text = fs.readFileSync(abs, "utf8");
      sites.push(...extractAdapterCallSites(rel, text));
    }
    assertAdapterPlacement(sites);
  });

  it("planted second adapter call site is red", () => {
    const providerSrc = fs.readFileSync(path.join(ROOT, PROVIDER), "utf8");
    const planted = `${providerSrc}\nexport function Bad() { useEvmAccountAdapter(); }\n`;
    const sites = extractAdapterCallSites(PROVIDER, planted);
    assert.equal(
      countByCallee(sites, "useEvmAccountAdapter"),
      2,
      "planted dual useEvmAccountAdapter must count as 2",
    );
    assert.throws(
      () => assertAdapterPlacement(sites),
      /useEvmAccountAdapter call sites must be exactly 1/,
    );
  });

  it("planted useActiveAccount that calls an adapter is red", () => {
    const dirty = `
import { useEvmAccountAdapter } from "@/lib/web3/evm-account-adapter";
export function useActiveAccount() {
  return useEvmAccountAdapter();
}
`;
    const sites = extractAdapterCallSites(ENTRY, dirty);
    assert.equal(sites.length, 1);
    assert.throws(
      () => assertAdapterPlacement(sites),
      /adapter call outside ActiveAccountProvider/,
    );
  });

  it("useActiveAccount source is a context re-export — no adapter calls", () => {
    const text = fs.readFileSync(path.join(ROOT, ENTRY), "utf8");
    const sites = extractAdapterCallSites(ENTRY, text);
    assert.deepEqual(sites, []);
    assert.doesNotMatch(text, /useEvmAccountAdapter|useSvmAccountAdapter/);
    assert.match(text, /useActiveAccountFromProvider as useActiveAccount/);
  });

  it("clean provider-only source stays green", () => {
    const providerSrc = fs.readFileSync(path.join(ROOT, PROVIDER), "utf8");
    const sites = extractAdapterCallSites(PROVIDER, providerSrc);
    assertAdapterPlacement(sites);
  });
});

describe("active-account identity construction policy (S8-D)", () => {
  it("provider and SVM adapter have no ActiveAccount literals and no snapshot deps", () => {
    for (const rel of IDENTITY_SCOPED) {
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assertCleanIdentitySource(rel, text);
    }
  });

  it("planted render-time SVM ActiveAccount literal is red", () => {
    const dirty = `
export function Bad(address: string) {
  const connected = { status: "connected", vm: "svm", address };
  return connected;
}
`;
    const hits = findActiveAccountLiterals(SVM_ADAPTER, dirty);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!, /ActiveAccount object literal in render path/);
    assert.throws(
      () => assertCleanIdentitySource(SVM_ADAPTER, dirty),
      /ActiveAccount object literal in render path/,
    );
  });

  it("planted [evm, svm] hook dependency array is red", () => {
    const dirty = `
import { useCallback } from "react";
export function Bad(evm: object, svm: object) {
  return useCallback(() => {}, [evm, svm]);
}
`;
    const hits = findSnapshotDepsInHookArrays(PROVIDER, dirty);
    assert.ok(hits.some((h) => h.includes('"evm"')));
    assert.ok(hits.some((h) => h.includes('"svm"')));
    assert.throws(
      () => assertCleanIdentitySource(PROVIDER, dirty),
      /snapshot identifier "evm" in useCallback deps/,
    );
  });

  it("svmActiveAccountFromAddress is only invoked from vocabulary apply + session connect", () => {
    const callRe = /\bsvmActiveAccountFromAddress\s*\(/g;
    const allowed = new Set([VOCAB, SESSION]);
    for (const abs of walkProductTsFiles(ROOT)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const text = fs.readFileSync(abs, "utf8");
      if (!callRe.test(text)) continue;
      callRe.lastIndex = 0;
      assert.ok(
        allowed.has(rel),
        `svmActiveAccountFromAddress call outside connect/apply owners (${rel})`,
      );
    }
    const vocab = fs.readFileSync(path.join(ROOT, VOCAB), "utf8");
    assert.match(vocab, /export function svmActiveAccountFromAddress/);
    assert.match(vocab, /export const DISCONNECTED_ACCOUNT/);
    const session = fs.readFileSync(path.join(ROOT, SESSION), "utf8");
    assert.match(session, /svmActiveAccountFromAddress\(/);
    assert.match(session, /applySvmSessionChangeDecision/);
  });
});

/**
 * setSession / setState updater that assigns to an Identifier declared outside
 * the updater — impure capture (StrictMode / async scheduling can skip
 * standard:disconnect). Shared by live scan and plants.
 */
export function findSetStateUpdaterOuterAssignments(
  filePath: string,
  sourceText: string,
): string[] {
  const kind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const hits: string[] = [];

  function localBindings(fn: ts.ArrowFunction | ts.FunctionExpression): Set<string> {
    const locals = new Set<string>();
    for (const p of fn.parameters) {
      if (ts.isIdentifier(p.name)) locals.add(p.name.text);
    }
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        locals.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
    return locals;
  }

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^set[A-Z]/.test(node.expression.text) &&
      node.arguments.length >= 1
    ) {
      const arg = node.arguments[0]!;
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
        const locals = localBindings(arg);
        const scan = (n: ts.Node) => {
          if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isIdentifier(n.left) &&
            !locals.has(n.left.text)
          ) {
            const { line } = sf.getLineAndCharacterOfPosition(
              n.left.getStart(sf),
            );
            hits.push(
              `setState updater assigns to outer variable "${n.left.text}" (${filePath}:${line + 1})`,
            );
          }
          ts.forEachChild(n, scan);
        };
        scan(arg);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("active-account session disconnect purity (S8-D)", () => {
  it("live svm-account-session has no setState updater outer assignments", () => {
    const text = fs.readFileSync(path.join(ROOT, SESSION), "utf8");
    assert.deepEqual(findSetStateUpdaterOuterAssignments(SESSION, text), []);
    assert.match(text, /useCallback\(async \(\) => \{[\s\S]*const current = session;/);
    assert.match(text, /\}, \[session\]\);/);
  });

  it("planted setSession updater assigning to an outer variable is red", () => {
    const dirty = `
export function Bad(setSession: (u: (p: unknown) => null) => void) {
  let wallet = null;
  setSession((prev) => {
    wallet = prev;
    return null;
  });
  return wallet;
}
`;
    const hits = findSetStateUpdaterOuterAssignments(SESSION, dirty);
    assert.equal(hits.length, 1);
    assert.match(
      hits[0]!,
      /setState updater assigns to outer variable "wallet"/,
    );
  });
});

describe("SVM session restore (silent preference)", () => {
  const PREFERENCE = "lib/web3/svm-session-preference.ts";
  const CONNECT_PICK = "lib/web3/svm-session-connect.ts";

  it("session owns silent restore + preference; interactive connect is non-silent", () => {
    const session = fs.readFileSync(path.join(ROOT, SESSION), "utf8");
    assert.match(session, /readSvmLastWalletName/);
    assert.match(session, /writeSvmLastWalletName/);
    assert.match(session, /clearSvmLastWalletName/);
    assert.match(session, /ensureSvmWalletDiscovery/);
    assert.match(session, /subscribeSvmWalletDiscovery/);
    assert.match(session, /silent:\s*true/);
    assert.match(session, /silent:\s*false/);
    assert.match(session, /pickSvmConnectAccount/);
    assert.match(session, /hydrateFromWallet/);

    // Interactive path must not pass silent:true
    assert.match(
      session,
      /hydrateFromWallet\(discovered\.wallet,\s*\{\s*silent:\s*false\s*\}\)/,
    );
    assert.match(
      session,
      /hydrateFromWallet\(discovered\.wallet,\s*\{\s*silent:\s*true\s*\}\)/,
    );
  });

  it("preference and pick helpers are not reimplemented outside owners", () => {
    const owners = new Set([SESSION, PREFERENCE, CONNECT_PICK]);
    for (const abs of walkProductTsFiles(ROOT)) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes("kargain:svm-last-wallet") && !owners.has(rel)) {
        assert.fail(`SVM preference storage key outside owner (${rel})`);
      }
      if (
        /\bconnect\s*\(\s*\{\s*silent:\s*true/.test(text) &&
        rel !== SESSION
      ) {
        assert.fail(`silent connect outside svm-account-session (${rel})`);
      }
    }
  });

  it("constructed: restore / silent connect outside session is red", () => {
    const planted = `
import { readSvmLastWalletName } from "@/lib/web3/svm-session-preference";
export function BadRestore(wallet: { features: Record<string, { connect: (i?: { silent?: boolean }) => Promise<unknown> } }>) {
  const name = readSvmLastWalletName();
  if (name) void wallet.features["standard:connect"].connect({ silent: true });
}
`;
    assert.match(planted, /silent:\s*true/);
    assert.throws(() => {
      if (/\bconnect\s*\(\s*\{\s*silent:\s*true/.test(planted)) {
        throw new Error("silent connect outside svm-account-session (plant)");
      }
    }, /silent connect outside/);
  });

  it("disconnect and clear clear preference; preference never holds an address invent path", () => {
    const session = fs.readFileSync(path.join(ROOT, SESSION), "utf8");
    assert.match(session, /const clear = useCallback\(\(\) => \{\s*clearSvmLastWalletName/);
    assert.match(
      session,
      /const disconnect = useCallback\(async \(\) => \{[\s\S]*clearSvmLastWalletName/,
    );
    assert.doesNotMatch(
      session,
      /readSvmLastWalletName\(\)[\s\S]{0,80}svmActiveAccountFromAddress/,
    );
  });
});
