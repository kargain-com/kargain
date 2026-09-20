/**
 * S8-D0 — derive consumer pairs from the route import graph.
 * Mechanism owners (choke-point ownerFiles union) are excluded.
 * Contract call sites carry (abiId, functionName) via TypeScript AST.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { ARCHITECTURAL_CHOKEPOINTS } from "@/lib/architecture/chokepoints";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SURFACE_SUPPORT_ENTRY_ROOTS: readonly string[] = [
  "app/(identity)/marketplace/[tokenId]/page.tsx",
  "app/(identity)/marketplace/[tokenId]/created/page.tsx",
  "app/(identity)/marketplace/[tokenId]/purchased/page.tsx",
  "app/(identity)/marketplace/[tokenId]/edit/page.tsx",
  "app/(identity)/passport/new/page.tsx",
  "app/(identity)/passport/[tokenId]/edit/page.tsx",
  "app/(public)/page.tsx",
  "app/(identity)/auctions/page.tsx",
  "app/(identity)/ops/commerce-pause/page.tsx",
  "app/(identity)/profile/[handle]/page.tsx",
  "app/(identity)/profile/edit/page.tsx",
  "app/(identity)/layout.tsx",
  "app/(public)/layout.tsx",
  "app/layout.tsx",
];

export const SURFACE_SUPPORT_FLOORS = {
  requireEvmSessionFilesInAppComponentsHooks: 75,
  txWriteAvailabilityComponentPlusLibOwners: 3 + 13,
  wagmiReadHookFiles: 28,
  derivedConsumerPairs: 1,
  capabilities: 1,
  migratedTxWriteOwners: 12,
} as const;

/** Primitives that take a config object with abi / functionName. */
export const SURFACE_SUPPORT_CONTRACT_CALL_PRIMITIVES = [
  "useReadContract",
  "useEvmWriteContract",
  "writeContractAsync",
] as const;

export const SURFACE_SUPPORT_READ_PRIMITIVES = new Set([
  "useReadContract",
  "useReadContracts",
  "useKeyedReadContracts",
  "useBalance",
  "useAccount",
  "useChainId",
  "useSwitchChain",
]);

export const SURFACE_SUPPORT_WRITE_PRIMITIVES = new Set([
  "useWriteContract",
  "useSendTransaction",
  "useEvmWriteContract",
  "useEvmSendTransaction",
  "writeContractAsync",
  "sendTransactionAsync",
  "runTx(",
  "awaitReceipt(",
  "useSignMessage",
]);

export const SURFACE_SUPPORT_SESSION_PRIMITIVES = new Set([
  "requireEvmSession",
  "requireEvmSigningBinding",
  "txWriteAvailability",
  "useWalletClient",
  "usePublicClient",
]);

export const SURFACE_SUPPORT_PRIMITIVES: ReadonlyArray<{
  name: string;
  re: RegExp;
}> = [
  { name: "useReadContract", re: /\buseReadContract\b/ },
  { name: "useWriteContract", re: /\buseWriteContract\b/ },
  { name: "useSendTransaction", re: /\buseSendTransaction\b/ },
  { name: "useReadContracts", re: /\buseReadContracts\b/ },
  { name: "useAccount", re: /\buseAccount\b/ },
  { name: "useChainId", re: /\buseChainId\b/ },
  { name: "useSwitchChain", re: /\buseSwitchChain\b/ },
  { name: "useBalance", re: /\buseBalance\b/ },
  { name: "useSignMessage", re: /\buseSignMessage\b/ },
  { name: "usePublicClient", re: /\busePublicClient\b/ },
  { name: "useWalletClient", re: /\buseWalletClient\b/ },
  { name: "useKeyedReadContracts", re: /\buseKeyedReadContracts\b/ },
  { name: "requireEvmSession", re: /\brequireEvmSession\s*\(/ },
  { name: "requireEvmSigningBinding", re: /\brequireEvmSigningBinding\s*\(/ },
  { name: "txWriteAvailability", re: /\btxWriteAvailability(?:ForCapability)?\s*\(/ },
  { name: "runTx(", re: /\brunTx\s*\(/ },
  { name: "awaitReceipt(", re: /\bawaitReceipt\s*\(/ },
  { name: "writeContractAsync", re: /\bwriteContractAsync\b/ },
  { name: "useEvmWriteContract", re: /\buseEvmWriteContract\b/ },
  { name: "useEvmSendTransaction", re: /\buseEvmSendTransaction\b/ },
  { name: "sendTransactionAsync", re: /\bsendTransactionAsync\b/ },
];

const LOCAL_ROOTS = ["app", "components", "hooks", "lib"] as const;

const LIFECYCLE_TX_WRITE_HOMES = new Set([
  "lib/web3/tx-write-availability.ts",
  "lib/web3/write-lifecycle.ts",
  "lib/web3/evm-write-lifecycle.ts",
]);

export type SurfaceConsumerPair = {
  file: string;
  primitive: string;
  functionName: string | null;
  /** Normalized ABI identifier when extracted from the call site. */
  abiId: string | null;
};

export type SurfaceFileContents = ReadonlyMap<string, string>;

export function mechanismOwnerFiles(
  chokepoints: readonly {
    ownerFiles?: readonly string[];
  }[] = ARCHITECTURAL_CHOKEPOINTS,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const cp of chokepoints) {
    for (const f of cp.ownerFiles ?? []) set.add(f);
  }
  return set;
}

export function filesDefiningCensusPrimitives(
  sources: SurfaceFileContents,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const [file, text] of sources) {
    const defined: string[] = [];
    for (const p of SURFACE_SUPPORT_PRIMITIVES) {
      const base = p.name.replace(/\($/, "");
      const exportRe = new RegExp(
        `export\\s+(?:async\\s+)?(?:function|const)\\s+${base}\\b|export\\s*\\{[^}]*\\b${base}\\b`,
      );
      const localDeclRe = new RegExp(`\\b(?:const|function)\\s+${base}\\b`);
      if (
        exportRe.test(text) ||
        (localDeclRe.test(text) && isSoleWagmiHome(file, text, base)) ||
        (p.re.test(text) && isSoleWagmiHome(file, text, base))
      ) {
        defined.push(p.name);
      }
    }
    if (/\bexport\s+function\s+surfaceSupport\b/.test(text)) {
      defined.push("surfaceSupport");
    }
    if (defined.length > 0) out.set(file, defined);
  }
  return out;
}

function isSoleWagmiHome(file: string, text: string, base: string): boolean {
  if (
    file === "lib/web3/evm-write-adapter.ts" ||
    file === "lib/web3/evm-account-adapter.ts" ||
    file === "lib/web3/keyed-multicall.ts"
  ) {
    return new RegExp(`\\b${base}\\b`).test(text);
  }
  if (file === "hooks/use-tx-sync.ts") {
    return base === "runTx" || base === "awaitReceipt";
  }
  if (
    file === "lib/web3/active-account.ts" ||
    file === "hooks/use-active-account.ts" ||
    file === "lib/web3/active-account-provider.tsx"
  ) {
    return (
      base === "requireEvmSession" || base === "requireEvmSigningBinding"
    );
  }
  if (
    file === "lib/web3/tx-write-availability.ts" ||
    file === "lib/web3/write-lifecycle.ts" ||
    file === "lib/web3/evm-write-lifecycle.ts"
  ) {
    return base === "txWriteAvailability";
  }
  return false;
}

function tryResolve(base: string, root: string = ROOT): string | null {
  for (const c of [
    base,
    base + ".ts",
    base + ".tsx",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      const rel = path.relative(root, c).split(path.sep).join("/");
      if (LOCAL_ROOTS.some((r) => rel === r || rel.startsWith(r + "/"))) {
        return rel;
      }
    }
  }
  return null;
}

function resolveImport(
  fromFile: string,
  spec: string,
  root: string = ROOT,
): string | null {
  if (spec.startsWith("@/")) {
    return tryResolve(path.join(root, spec.slice(2)), root);
  }
  if (spec.startsWith(".") || spec.startsWith("/")) {
    return tryResolve(path.resolve(path.dirname(fromFile), spec), root);
  }
  return null;
}

function extractImports(
  text: string,
  file: string,
  root: string = ROOT,
): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)(?:\s+type)?[\s\S]*?from\s*["']([^"']+)["']/g;
  const dyn = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const rx of [re, dyn]) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text))) {
      const stmtStart = text.lastIndexOf("\n", m.index);
      const stmt = text.slice(stmtStart + 1, m.index + m[0].length);
      if (/^\s*import\s+type\b/.test(stmt) || /^\s*export\s+type\b/.test(stmt)) {
        continue;
      }
      const brace = stmt.match(/import\s*\{([^}]*)\}\s*from/);
      if (brace) {
        const names = brace[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.length > 0 && names.every((n) => /^type\s+/.test(n))) {
          continue;
        }
      }
      const resolved = resolveImport(path.join(root, file), m[1], root);
      if (resolved) out.push(resolved);
    }
  }
  return [...new Set(out)];
}

export function loadLiveSurfaceSources(): SurfaceFileContents {
  const map = new Map<string, string>();
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        const rel = path.relative(ROOT, full).split(path.sep).join("/");
        map.set(rel, fs.readFileSync(full, "utf8"));
      }
    }
  };
  for (const r of LOCAL_ROOTS) walk(path.join(ROOT, r));
  return map;
}

function scriptKindFor(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Normalize an abi expression text to a stable identifier. */
export function normalizeAbiId(exprText: string): string {
  let t = exprText.replace(/\s+/g, " ").trim();
  // Strip trailing `as const` / type assertions
  t = t.replace(/\s+as\s+const\b.*$/i, "").trim();
  t = t.replace(/\s+as\s+[A-Za-z0-9_.<>,\s|&[\]]+$/i, "").trim();
  if (/^commerceModeAbi\s*\(/.test(t)) return "commerceModeAbi";
  if (/^AGGREGATOR_V3_ABI$/.test(t)) return "AGGREGATOR_V3_ABI";
  if (/^erc20Abi$|^ERC20_ABI$|^PAYMENT_TOKEN_ABI$|^USDC_ABI$/.test(t)) {
    return "erc20Abi";
  }
  // Call expression: take callee name
  const call = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (call) {
    const callee = call[1];
    if (callee === "commerceModeAbi") return "commerceModeAbi";
    return callee;
  }
  // Identifier or property access — take the rightmost Identifier-like token
  const m = t.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  if (m) {
    const id = m[1];
    if (id === "ERC20_ABI" || id === "erc20Abi") return "erc20Abi";
    return id;
  }
  return t;
}

function resolveAbiBinding(
  sf: ts.SourceFile,
  name: string,
): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node) => {
    if (found != null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = node.initializer;
      if (ts.isIdentifier(init)) {
        found = resolveAbiBinding(sf, init.text) ?? normalizeAbiId(init.text);
      } else if (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
        found = resolveAbiExpression(init.expression, sf);
      } else if (ts.isArrayLiteralExpression(init)) {
        found = resolveAbiExpression(init, sf);
      } else {
        found = normalizeAbiId(init.getText(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function resolveAbiExpression(
  init: ts.Expression,
  sf: ts.SourceFile,
): string {
  if (ts.isIdentifier(init)) {
    const bound = resolveAbiBinding(sf, init.text);
    return bound ?? normalizeAbiId(init.text);
  }
  if (ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) {
    return resolveAbiExpression(init.expression, sf);
  }
  if (ts.isArrayLiteralExpression(init)) {
    // Inline ERC-20 fragment ABIs — classify by method names present
    const text = init.getText(sf);
    if (
      /\bname:\s*"balanceOf"/.test(text) ||
      /\bname:\s*"allowance"/.test(text) ||
      /\bname:\s*"approve"/.test(text) ||
      /\bname:\s*"transfer"/.test(text) ||
      /\bname:\s*"decimals"/.test(text)
    ) {
      return "erc20Abi";
    }
  }
  return normalizeAbiId(init.getText(sf));
}

function extractStaticFunctionNames(
  init: ts.Expression,
): string[] {
  if (
    ts.isAsExpression(init) ||
    ts.isSatisfiesExpression(init) ||
    ts.isParenthesizedExpression(init)
  ) {
    return extractStaticFunctionNames(init.expression);
  }
  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    return [init.text];
  }
  if (ts.isConditionalExpression(init)) {
    const whenTrue = extractStaticFunctionNames(init.whenTrue);
    const whenFalse = extractStaticFunctionNames(init.whenFalse);
    if (whenTrue.length > 0 && whenFalse.length > 0) {
      return [...whenTrue, ...whenFalse];
    }
  }
  return [];
}

type RuntimeFunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction;

function enclosingFunctionLike(node: ts.Node): RuntimeFunctionLike | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function callableBindingName(
  fn: RuntimeFunctionLike,
): string | null {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  let current: ts.Node | undefined = fn;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      ts.isIdentifier(parent.name)
    ) {
      return parent.name.text;
    }
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isSourceFile(parent)
    ) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Resolve `functionName` when a write helper forwards one of its parameters.
 * Calls to declarations and const-bound callbacks are both included.
 */
function resolveForwardedFunctionNames(
  init: ts.Expression,
  sf: ts.SourceFile,
): string[] {
  if (!ts.isIdentifier(init)) return [];
  let fn = enclosingFunctionLike(init);
  let parameterIndex = -1;
  while (fn) {
    parameterIndex = fn.parameters.findIndex(
      (parameter) =>
        ts.isIdentifier(parameter.name) &&
        parameter.name.text === init.text,
    );
    if (parameterIndex >= 0) break;
    fn = enclosingFunctionLike(fn);
  }
  if (!fn || parameterIndex < 0) return [];
  const bindingName = callableBindingName(fn);
  if (!bindingName) return [];

  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === bindingName
    ) {
      const argument = node.arguments[parameterIndex];
      if (argument) {
        for (const name of extractStaticFunctionNames(argument)) names.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...names];
}

function extractAbiAndFunctionNamesFromObject(
  obj: ts.ObjectLiteralExpression,
  sf: ts.SourceFile,
): {
  functionNames: string[];
  abiId: string | null;
  hasFunctionName: boolean;
} {
  let functionNames: string[] = [];
  let abiRaw: string | null = null;
  let hasFunctionName = false;
  for (const prop of obj.properties) {
    if (ts.isShorthandPropertyAssignment(prop)) {
      const name = prop.name.text;
      if (name === "abi") {
        abiRaw = resolveAbiBinding(sf, "abi") ?? "abi";
      }
      if (name === "functionName") {
        hasFunctionName = true;
        functionNames = resolveForwardedFunctionNames(prop.name, sf);
      }
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = prop.name.getText(sf);
    if (name === "functionName") {
      hasFunctionName = true;
      functionNames = extractStaticFunctionNames(prop.initializer);
      if (functionNames.length === 0) {
        functionNames = resolveForwardedFunctionNames(prop.initializer, sf);
      }
    }
    if (name === "abi") {
      abiRaw = resolveAbiExpression(prop.initializer, sf);
    }
  }
  return { functionNames, abiId: abiRaw, hasFunctionName };
}

function calleePrimitiveName(
  expr: ts.Expression,
  sf: ts.SourceFile,
): string | null {
  const text = expr.getText(sf);
  for (const name of SURFACE_SUPPORT_CONTRACT_CALL_PRIMITIVES) {
    if (text === name || text.endsWith("." + name)) return name;
  }
  return null;
}

/**
 * Extract contract call sites with static functionName (+ abi when present).
 * Bare useEvmWriteContract() with no config object is skipped (not a mapping site).
 * Keyed batch entries come from useKeyedReadContracts({ contracts }) or
 * useMemo arrays assigned to `contracts` — not every object literal in the file.
 */
export function extractContractCallPairs(
  file: string,
  text: string,
): SurfaceConsumerPair[] {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );
  const pairs: SurfaceConsumerPair[] = [];
  const seen = new Set<string>();
  const push = (
    primitive: string,
    functionName: string | null,
    abiId: string | null,
  ) => {
    const key = `${primitive}::${functionName}::${abiId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ file, primitive, functionName, abiId });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const primitive = calleePrimitiveName(node.expression, sf);
      if (primitive != null) {
        for (const arg of node.arguments) {
          if (ts.isObjectLiteralExpression(arg)) {
            const { functionNames, abiId, hasFunctionName } =
              extractAbiAndFunctionNamesFromObject(arg, sf);
            for (const functionName of functionNames) {
              push(primitive, functionName, abiId);
            }
            if (hasFunctionName && functionNames.length === 0 && abiId != null) {
              push(primitive, null, abiId);
            }
          }
        }
      }
      const callee = node.expression.getText(sf);
      if (
        callee === "useKeyedReadContracts" ||
        callee.endsWith(".useKeyedReadContracts")
      ) {
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            if (prop.name.getText(sf) !== "contracts") continue;
            collectKeyedContractEntries(prop.initializer, sf, push);
          }
        }
      }
    }
    // useMemo(() => [ { abi, functionName }, ... ], ...) used as contracts source
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === "useMemo" &&
      node.arguments.length > 0
    ) {
      const first = node.arguments[0];
      if (
        ts.isArrowFunction(first) ||
        ts.isFunctionExpression(first)
      ) {
        const body = first.body;
        const expression = ts.isBlock(body)
          ? findReturnExpression(body)
          : ts.isParenthesizedExpression(body)
            ? body.expression
            : body;
        if (expression) {
          collectKeyedContractEntries(expression, sf, push);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return pairs;
}

function findReturnArray(block: ts.Block): ts.ArrayLiteralExpression | null {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      if (ts.isArrayLiteralExpression(stmt.expression)) return stmt.expression;
    }
  }
  return null;
}

function collectKeyedContractEntries(
  expr: ts.Expression,
  sf: ts.SourceFile,
  push: (
    primitive: string,
    functionName: string | null,
    abiId: string | null,
  ) => void,
): void {
  if (ts.isIdentifier(expr)) {
    const bound = resolveExpressionBinding(sf, expr.text);
    if (bound) collectKeyedContractEntries(bound, sf, push);
    return;
  }
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    collectKeyedContractEntries(expr.expression, sf, push);
    return;
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    (expr.expression.name.text === "map" ||
      expr.expression.name.text === "flatMap")
  ) {
    const names = stringLiteralsFromArrayExpression(
      expr.expression.expression,
      sf,
    );
    const callback = expr.arguments[0];
    if (
      callback &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
      callback.parameters.length > 0
    ) {
      const rawBody = ts.isParenthesizedExpression(callback.body)
        ? callback.body.expression
        : callback.body;
      const body = ts.isBlock(rawBody)
        ? findReturnExpression(rawBody)
        : rawBody;
      if (body) {
        if (ts.isObjectLiteralExpression(body)) {
          const extracted = extractAbiAndFunctionNamesFromObject(body, sf);
          for (const name of extracted.functionNames) {
            push("useKeyedReadContracts", name, extracted.abiId);
          }
          if (extracted.functionNames.length === 0) {
            for (const name of names) {
              push("useKeyedReadContracts", name, extracted.abiId);
            }
          }
        } else {
          collectKeyedContractEntries(body, sf, push);
        }
      }
    }
    return;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el)) {
        collectKeyedContractEntries(el.expression, sf, push);
        continue;
      }
      if (ts.isObjectLiteralExpression(el)) {
        const { functionNames, abiId, hasFunctionName } = extractAbiAndFunctionNamesFromObject(
          el,
          sf,
        );
        for (const functionName of functionNames) {
          push("useKeyedReadContracts", functionName, abiId);
        }
        if (hasFunctionName && functionNames.length === 0 && abiId != null) {
          push("useKeyedReadContracts", null, abiId);
        }
      }
    }
  }
}

function stringLiteralsFromArrayExpression(
  expression: ts.Expression,
  sf: ts.SourceFile,
): string[] {
  let resolved: ts.Expression = expression;
  if (ts.isIdentifier(resolved)) {
    resolved = resolveExpressionBinding(sf, resolved.text) ?? resolved;
  }
  if (
    ts.isParenthesizedExpression(resolved) ||
    ts.isAsExpression(resolved) ||
    ts.isSatisfiesExpression(resolved)
  ) {
    return stringLiteralsFromArrayExpression(resolved.expression, sf);
  }
  if (!ts.isArrayLiteralExpression(resolved)) return [];
  return resolved.elements.flatMap((element) =>
    ts.isExpression(element) ? extractStaticFunctionNames(element) : [],
  );
}

/** Resolve a const binding, including `useMemo(() => [...], ...)`. */
function resolveExpressionBinding(
  sf: ts.SourceFile,
  name: string,
): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node) => {
    if (found != null) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      if (
        ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(sf) === "useMemo" &&
        node.initializer.arguments.length > 0
      ) {
        const first = node.initializer.arguments[0];
        if (ts.isArrowFunction(first) || ts.isFunctionExpression(first)) {
          const body = first.body;
          found = ts.isBlock(body) ? findReturnExpression(body) : body;
        }
      } else {
        found = node.initializer;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function findReturnExpression(block: ts.Block): ts.Expression | null {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) return stmt.expression;
  }
  return null;
}

export function deriveSurfaceConsumerPairs(
  sources: SurfaceFileContents,
  entryRoots: readonly string[] = SURFACE_SUPPORT_ENTRY_ROOTS,
  ownerFiles: ReadonlySet<string> = mechanismOwnerFiles(),
): SurfaceConsumerPair[] {
  const visited = new Set<string>();
  const queue = [...entryRoots];
  while (queue.length > 0) {
    const f = queue.pop()!;
    if (visited.has(f)) continue;
    const text = sources.get(f);
    if (text == null) continue;
    visited.add(f);
    for (const dep of extractImports(text, f)) {
      if (!visited.has(dep) && sources.has(dep)) queue.push(dep);
    }
  }

  const pairs: SurfaceConsumerPair[] = [];
  const pairSeen = new Set<string>();
  const push = (p: SurfaceConsumerPair) => {
    const k = pairKey(p);
    if (pairSeen.has(k)) return;
    pairSeen.add(k);
    pairs.push(p);
  };

  for (const f of [...visited].sort()) {
    if (ownerFiles.has(f)) continue;
    const text = sources.get(f);
    if (text == null) continue;

    for (const p of extractContractCallPairs(f, text)) {
      push(p);
    }

    for (const p of SURFACE_SUPPORT_PRIMITIVES) {
      if (
        (
          SURFACE_SUPPORT_CONTRACT_CALL_PRIMITIVES as readonly string[]
        ).includes(p.name)
      ) {
        continue;
      }
      if (p.name === "useKeyedReadContracts") {
        // Emitted via AST contract entries when present
        continue;
      }
      if (p.re.test(text)) {
        push({ file: f, primitive: p.name, functionName: null, abiId: null });
      }
    }
  }
  return pairs;
}

/**
 * Files that contain a session/runTx gate but no mapped write_action from calls.
 * Reported (pinned), never invent a capability default.
 */
export function deriveSessionGatesWithoutWrites(
  mappedWriteFiles: ReadonlySet<string>,
  derived: readonly SurfaceConsumerPair[],
): string[] {
  const sessionFiles = new Set<string>();
  for (const p of derived) {
    if (
      SURFACE_SUPPORT_SESSION_PRIMITIVES.has(p.primitive) ||
      p.primitive === "runTx(" ||
      p.primitive === "awaitReceipt("
    ) {
      sessionFiles.add(p.file);
    }
  }
  return [...sessionFiles]
    .filter((f) => !mappedWriteFiles.has(f))
    .sort();
}

export function deriveMigratedTxWriteOwners(
  sources: SurfaceFileContents,
): string[] {
  const set = new Set<string>();
  for (const [file, text] of sources) {
    if (!file.startsWith("lib/")) continue;
    if (LIFECYCLE_TX_WRITE_HOMES.has(file)) continue;
    if (/\btxWriteAvailabilityForCapability\s*\(/.test(text)) {
      set.add(file);
    } else if (/\btxWriteAvailability\s*\(/.test(text)) {
      set.add(file);
    }
  }
  return [...set].sort();
}

export function pairKey(pair: SurfaceConsumerPair): string {
  const fn = pair.functionName ?? "";
  const abi = pair.abiId ?? "";
  return `${pair.file}::${pair.primitive}::${fn}::${abi}`;
}

/** Shorter key used by census fixture lookup (file + primitive + functionName). */
export function pairKeyWithoutAbi(pair: {
  file: string;
  primitive: string;
  functionName: string | null;
}): string {
  return `${pair.file}::${pair.primitive}::${pair.functionName ?? ""}`;
}

export const OWNER_PROSE_PATH_TOKEN_RE =
  /(?:\b(?:lib|hooks|app|components|src|test)\/|\.tsx?\b)/;
