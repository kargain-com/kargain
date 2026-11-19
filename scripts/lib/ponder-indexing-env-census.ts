/**
 * Sole owner of the env census of the Ponder indexing identity (ADR 0016 §a/§b).
 *
 * Every `process.env` read in the static-import closure of the indexing
 * identity is classified here as `transport`, `database` or `local`. None of
 * them changes which rows exist on a commercial chain: transport and database
 * are outside build_id, and the deploy preflight refuses every `local` key that
 * is set. An unclassified read, or a classified key that no file reads, is a
 * defect (guard: test/ponder-indexing-env-census-policy.test.ts).
 *
 * A key ending in `*` classifies template reads `process.env[`PREFIX${…}`]`.
 */
import ts from "typescript";

export type IndexingEnvClass = "transport" | "database" | "local";

export type IndexingEnvCensusEntry = {
  key: string;
  class: IndexingEnvClass;
};

export const PONDER_INDEXING_ENV_CENSUS: readonly IndexingEnvCensusEntry[] = [
  { key: "DATABASE_URL", class: "database" },
  { key: "PONDER_DATABASE_URL", class: "database" },
  { key: "DATABASE_PRIVATE_URL", class: "database" },
  { key: "PONDER_PGLITE_DIR", class: "database" },
  { key: "SVM_INGEST_DATABASE_URL", class: "database" },
  { key: "DATABASE_SCHEMA", class: "database" },
  { key: "PONDER_RPC_URLS_*", class: "transport" },
  { key: "PONDER_GETLOGS_BLOCK_RANGE_*", class: "transport" },
  { key: "ARWEAVE_GATEWAY", class: "transport" },
  { key: "NEXT_PUBLIC_ARWEAVE_GATEWAY", class: "transport" },
  { key: "NEXT_PUBLIC_RPC_BY_CHAIN", class: "transport" },
  { key: "NEXT_PUBLIC_RPC_*", class: "transport" },
  { key: "PONDER_ENABLE_LOCAL", class: "local" },
  { key: "PONDER_LOCAL_ONLY", class: "local" },
  { key: "PONDER_RPC_URL_31337", class: "local" },
  { key: "PONDER_START_BLOCK_31337", class: "local" },
  { key: "NEXT_PUBLIC_ENABLE_LOCAL_CHAIN", class: "local" },
  { key: "KARGAIN_DEPLOYMENTS_DIR", class: "local" },
  { key: "PONDER_KAR_PASSPORT_ADDRESS", class: "local" },
  { key: "PONDER_KAR_PRO_PASS_ADDRESS", class: "local" },
  { key: "PONDER_KAR_PRO_STAKING_ADDRESS", class: "local" },
  { key: "PONDER_USDC_ADDRESS", class: "local" },
  { key: "PONDER_NATIVE_FEED_ADDRESS", class: "local" },
  { key: "PONDER_TIMELOCK_ADDRESS", class: "local" },
  { key: "PONDER_PLATFORM_RECIPIENT_ADDRESS", class: "local" },
  { key: "PONDER_FIXED_PRICE_CONSIGNMENT_ADDRESS", class: "local" },
  { key: "PONDER_ASCENDING_CONSIGNMENT_ADDRESS", class: "local" },
  { key: "PONDER_BRIDGE_GATEWAY_ADDRESS", class: "local" },
];

export type ProcessEnvRead = { file: string; line: number } & (
  | { kind: "key"; key: string }
  | { kind: "prefix"; prefix: string }
  | { kind: "opaque" }
);

function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (
      ts.isAsExpression(e) ||
      ts.isParenthesizedExpression(e) ||
      ts.isNonNullExpression(e) ||
      ts.isSatisfiesExpression(e) ||
      ts.isTypeAssertionExpression(e)
    ) {
      e = e.expression;
      continue;
    }
    return e;
  }
}

function isProcessEnvExpr(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  return (
    ts.isPropertyAccessExpression(e) &&
    e.name.text === "env" &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "process"
  );
}

/** True when `expr` is `process.env` or `… ?? process.env` (rightmost). */
function initializerYieldsProcessEnv(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (isProcessEnvExpr(e)) return true;
  if (
    ts.isBinaryExpression(e) &&
    e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  ) {
    return initializerYieldsProcessEnv(e.right);
  }
  return false;
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration;

type AliasKind = "alias" | "shadow";

/** Parameter / declaration whose initializer is (or nullish-falls to) process.env. */
function isProcessEnvBindingInit(node: ts.Node): boolean {
  if (ts.isParameter(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  if (ts.isVariableDeclaration(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  return false;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function pushNamedAccess(
  out: ProcessEnvRead[],
  file: string,
  sf: ts.SourceFile,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): void {
  const line = lineOf(sf, access);
  if (ts.isPropertyAccessExpression(access)) {
    out.push({ file, line, kind: "key", key: access.name.text });
    return;
  }
  const arg = unwrap(access.argumentExpression);
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    out.push({ file, line, kind: "key", key: arg.text });
  } else if (ts.isTemplateExpression(arg) && arg.head.text.length > 0) {
    out.push({ file, line, kind: "prefix", prefix: arg.head.text });
  } else {
    out.push({ file, line, kind: "opaque" });
  }
}

/**
 * Plain property names from an object binding pattern, or `opaque` when the
 * pattern has rest / computed / nested elements.
 */
function destructureObjectPattern(
  pattern: ts.ObjectBindingPattern,
  file: string,
  sf: ts.SourceFile,
  out: ProcessEnvRead[],
): void {
  const line = lineOf(sf, pattern);
  for (const el of pattern.elements) {
    if (el.dotDotDotToken) {
      out.push({ file, line, kind: "opaque" });
      continue;
    }
    if (el.propertyName && !ts.isIdentifier(el.propertyName)) {
      out.push({ file, line, kind: "opaque" });
      continue;
    }
    if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) {
      out.push({ file, line, kind: "opaque" });
      continue;
    }
    const key = el.propertyName
      ? (el.propertyName as ts.Identifier).text
      : ts.isIdentifier(el.name)
        ? el.name.text
        : null;
    if (key) out.push({ file, line, kind: "key", key });
    else out.push({ file, line, kind: "opaque" });
  }
}

/** True when `body` binds `param.env` / `param?.env` with `?? process.env`. */
function bodyConsumesOptionsEnv(
  body: ts.Node | undefined,
  paramName: string,
): boolean {
  if (!body) return false;
  let found = false;
  const isOptsEnvAccess = (expr: ts.Expression): boolean => {
    const left = unwrap(expr);
    return (
      ts.isPropertyAccessExpression(left) &&
      left.name.text === "env" &&
      ts.isIdentifier(left.expression) &&
      left.expression.text === paramName
    );
  };
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      isProcessEnvExpr(node.right) &&
      isOptsEnvAccess(node.left)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

/**
 * Climb through casts/parens and the right side of `??` to see whether
 * `sourceExpr` is only introducing a process.env binding (no read yet).
 */
function isQuietProcessEnvBindingSite(sourceExpr: ts.Expression): boolean {
  let cur: ts.Node = sourceExpr;
  for (;;) {
    const parent = cur.parent;
    if (!parent) return false;
    if (
      (ts.isAsExpression(parent) ||
        ts.isParenthesizedExpression(parent) ||
        ts.isNonNullExpression(parent) ||
        ts.isSatisfiesExpression(parent) ||
        ts.isTypeAssertionExpression(parent)) &&
      parent.expression === cur
    ) {
      cur = parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      parent.right === cur
    ) {
      cur = parent;
      continue;
    }
    if (isProcessEnvBindingInit(parent)) return true;
    // Destructuring: `const { A } = process.env` — keys emitted by the
    // VariableDeclaration visit; process.env itself stays quiet.
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === cur &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      return true;
    }
    return false;
  }
}

type EnvCalleeInfo = {
  /** Parameter indices with `= process.env`. */
  direct: Set<number>;
  /** Parameter indices that are options objects consuming `.env ?? process.env`. */
  optionsEnv: Set<number>;
};

function collectEnvCallees(sf: ts.SourceFile): Map<string, EnvCalleeInfo> {
  const map = new Map<string, EnvCalleeInfo>();
  const add = (name: string, info: EnvCalleeInfo): void => {
    const prev = map.get(name);
    if (!prev) {
      map.set(name, info);
      return;
    }
    for (const i of info.direct) prev.direct.add(i);
    for (const i of info.optionsEnv) prev.optionsEnv.add(i);
  };
  const inspect = (fn: FunctionLike, name: string | undefined): void => {
    if (!name) return;
    const direct = new Set<number>();
    const optionsEnv = new Set<number>();
    fn.parameters.forEach((p, i) => {
      if (
        p.initializer &&
        initializerYieldsProcessEnv(p.initializer) &&
        ts.isIdentifier(p.name)
      ) {
        direct.add(i);
      } else if (
        ts.isIdentifier(p.name) &&
        bodyConsumesOptionsEnv(fn.body, p.name.text)
      ) {
        optionsEnv.add(i);
      }
    });
    if (direct.size > 0 || optionsEnv.size > 0) {
      add(name, { direct, optionsEnv });
    }
  };
  const walk = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      inspect(node, node.name.text);
    } else if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      inspect(node, node.name.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isFunctionExpression(node.initializer) ||
        ts.isArrowFunction(node.initializer))
    ) {
      inspect(node.initializer, node.name.text);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return map;
}

/**
 * Every `process.env` occurrence in `source`, plus named reads on bindings
 * initialised from `process.env`. Destructuring yields named keys (or opaque
 * for rest/computed/nested). Any other alias use is opaque, except same-file
 * forwarding to a callee whose matching parameter is itself an env binding.
 */
export function scanProcessEnvReads(
  file: string,
  source: string,
): ProcessEnvRead[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: ProcessEnvRead[] = [];
  const callees = collectEnvCallees(sf);
  /** Nested scopes: name → alias | shadow. */
  const aliasStack: Array<Map<string, AliasKind>> = [new Map()];

  function lookupAlias(name: string): AliasKind | undefined {
    for (let i = aliasStack.length - 1; i >= 0; i--) {
      const k = aliasStack[i]!.get(name);
      if (k) return k;
    }
    return undefined;
  }

  function aliasesEnv(name: string): boolean {
    return lookupAlias(name) === "alias";
  }

  function bindInCurrent(name: string, kind: AliasKind): void {
    aliasStack[aliasStack.length - 1]!.set(name, kind);
  }

  function isSameFileEnvForward(
    call: ts.CallExpression,
    arg: ts.Expression,
  ): boolean {
    const callee = unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return false;
    const info = callees.get(callee.text);
    if (!info) return false;
    const idx = call.arguments.indexOf(arg);
    if (idx < 0) return false;
    const u = unwrap(arg);
    // Direct: foo(env)
    if (info.direct.has(idx) && ts.isIdentifier(u) && aliasesEnv(u.text)) {
      return true;
    }
    // Options: foo({ env }) or foo({ env: env })
    if (info.optionsEnv.has(idx) && ts.isObjectLiteralExpression(u)) {
      for (const prop of u.properties) {
        if (
          ts.isShorthandPropertyAssignment(prop) &&
          aliasesEnv(prop.name.text)
        ) {
          return true;
        }
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "env") {
          const init = unwrap(prop.initializer);
          if (ts.isIdentifier(init) && aliasesEnv(init.text)) return true;
        }
      }
    }
    return false;
  }

  function reportOpaque(node: ts.Node): void {
    out.push({ file, line: lineOf(sf, node), kind: "opaque" });
  }

  function handleEnvSourceUse(
    sourceExpr: ts.Expression,
    /** The process.env node or alias identifier being used. */
    envNode: ts.Node,
  ): void {
    const parent = sourceExpr.parent;

    // process.env.KEY / alias.KEY
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === sourceExpr
    ) {
      pushNamedAccess(out, file, sf, parent);
      return;
    }
    // process.env["KEY"] / process.env[`P_${id}`]
    if (
      ts.isElementAccessExpression(parent) &&
      parent.expression === sourceExpr
    ) {
      pushNamedAccess(out, file, sf, parent);
      return;
    }
    // Binding / destructure init — keys (if any) come from the declaration visit
    if (isQuietProcessEnvBindingSite(sourceExpr)) return;

    // Same-file forward: foo(env) / foo({ env })
    if (ts.isCallExpression(parent) && isSameFileEnvForward(parent, sourceExpr)) {
      return;
    }
    if (
      (ts.isShorthandPropertyAssignment(parent) ||
        (ts.isPropertyAssignment(parent) &&
          parent.initializer === sourceExpr)) &&
      ts.isObjectLiteralExpression(parent.parent) &&
      ts.isCallExpression(parent.parent.parent) &&
      isSameFileEnvForward(parent.parent.parent, parent.parent)
    ) {
      return;
    }

    reportOpaque(envNode);
  }

  function withFunctionScope(fn: FunctionLike): void {
    const scope = new Map<string, AliasKind>();
    for (const p of fn.parameters) {
      if (!ts.isIdentifier(p.name)) continue;
      if (p.initializer && initializerYieldsProcessEnv(p.initializer)) {
        scope.set(p.name.text, "alias");
      } else {
        // Non-env parameter shadows an outer alias of the same name.
        scope.set(p.name.text, "shadow");
      }
    }
    aliasStack.push(scope);
    if (fn.body) visit(fn.body);
    for (const p of fn.parameters) {
      if (p.initializer) visit(p.initializer);
      if (p.type) visit(p.type);
    }
    aliasStack.pop();
  }

  function visit(node: ts.Node): void {
    // Named property / element on an alias — handled when we see the access.
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliasesEnv(node.expression.text)
    ) {
      pushNamedAccess(out, file, sf, node);
      // Do not visit the alias identifier as a bare use.
      visit(node.name);
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliasesEnv(node.expression.text)
    ) {
      pushNamedAccess(out, file, sf, node);
      visit(node.argumentExpression);
      return;
    }

    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      if (
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
        node.name
      ) {
        visit(node.name);
      }
      withFunctionScope(node);
      return;
    }

    // Variable bindings: alias, shadow, or destructure from process.env
    if (ts.isVariableDeclaration(node)) {
      if (node.initializer && ts.isIdentifier(node.name)) {
        if (initializerYieldsProcessEnv(node.initializer)) {
          // Visit initializer before binding so `opts?.env ?? process.env`
          // does not treat the property name `env` as the new alias.
          visit(node.initializer);
          bindInCurrent(node.name.text, "alias");
          if (node.type) visit(node.type);
          return;
        }
        // Any other initializer shadows an outer alias of this name.
        bindInCurrent(node.name.text, "shadow");
      }
      if (
        node.initializer &&
        initializerYieldsProcessEnv(node.initializer) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        destructureObjectPattern(node.name, file, sf, out);
        visit(node.initializer);
        return;
      }
      if (
        node.initializer &&
        ts.isObjectBindingPattern(node.name) &&
        ts.isIdentifier(unwrap(node.initializer)) &&
        aliasesEnv((unwrap(node.initializer) as ts.Identifier).text)
      ) {
        destructureObjectPattern(node.name, file, sf, out);
        visit(node.initializer);
        return;
      }
    }

    // Bare alias identifier use (value position only — not a property/binding name)
    if (ts.isIdentifier(node) && aliasesEnv(node.text)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) &&
          (parent.name === node || parent.propertyName === node)) ||
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isFunctionDeclaration(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node)
      ) {
        // Name position — not a read of the alias value.
      } else if (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node
      ) {
        // handled by PropertyAccess branch
      } else if (
        ts.isElementAccessExpression(parent) &&
        parent.expression === node
      ) {
        // handled by ElementAccess branch
      } else if (
        ts.isVariableDeclaration(parent) &&
        parent.initializer === node &&
        ts.isObjectBindingPattern(parent.name)
      ) {
        // handled by destructure branch
      } else {
        handleEnvSourceUse(node, node);
        return;
      }
    }

    // process.env itself (including through casts/parens via isProcessEnvExpr on wrappers)
    if (ts.isExpression(node) && isProcessEnvExpr(node)) {
      // Only handle the innermost process.env PropertyAccess, or a wrapper
      // whose parent is the interesting use (cast).D / binding / opaque.
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "env" &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process"
      ) {
        handleEnvSourceUse(node, node);
        return;
      }
      // Parenthesized / as-expression wrapping process.env: if parent uses it
      // as property access (.D), named; else defer to handleEnvSourceUse.
      if (
        (ts.isParenthesizedExpression(node) ||
          ts.isAsExpression(node) ||
          ts.isTypeAssertionExpression(node)) &&
        isProcessEnvExpr(node)
      ) {
        handleEnvSourceUse(node, node);
        return;
      }
    }

    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      aliasStack.push(new Map());
      ts.forEachChild(node, visit);
      aliasStack.pop();
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return out;
}

function censusEntryFor(
  read: ProcessEnvRead,
  census: readonly IndexingEnvCensusEntry[],
): IndexingEnvCensusEntry | undefined {
  if (read.kind === "key") return census.find((e) => e.key === read.key);
  if (read.kind === "prefix") {
    return census.find((e) => e.key === `${read.prefix}*`);
  }
  return undefined;
}

export type IndexingEnvCensusDefects = {
  unclassified: ProcessEnvRead[];
  unread: IndexingEnvCensusEntry[];
};

export function indexingEnvCensusDefects(
  reads: readonly ProcessEnvRead[],
  census: readonly IndexingEnvCensusEntry[] = PONDER_INDEXING_ENV_CENSUS,
): IndexingEnvCensusDefects {
  const used = new Set<string>();
  const unclassified: ProcessEnvRead[] = [];
  for (const read of reads) {
    const entry = censusEntryFor(read, census);
    if (entry) used.add(entry.key);
    else unclassified.push(read);
  }
  return {
    unclassified,
    unread: census.filter((e) => !used.has(e.key)),
  };
}

/** Commercial start-block family (any chain but the local one), removed by ADR 0016 §a. */
const REMOVED_START_BLOCK_KEY_RE = /^PONDER_START_BLOCK_?\d*$/;
const ADDRESS_KEY_RE = /^PONDER_[A-Z0-9_]+_ADDRESS$/;

export type PonderDeployEnvRefusal = {
  reason: "removed_env_key" | "database_schema_override" | "local_mode_set";
  key: string;
};

function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

/**
 * ADR 0016 §a/§c refusals on the env Compose resolves for `ponder`:
 * a removed key or any `PONDER_*_ADDRESS` (only local mode reads them), a
 * `DATABASE_SCHEMA` override, then any other `local` census key that is set.
 */
export function ponderDeployEnvRefusal(
  env: NodeJS.ProcessEnv,
): PonderDeployEnvRefusal | null {
  const localKeys = new Set(
    PONDER_INDEXING_ENV_CENSUS.filter((e) => e.class === "local").map(
      (e) => e.key,
    ),
  );
  const setKeys = Object.keys(env)
    .filter((key) => isSet(env[key]))
    .sort();
  for (const key of setKeys) {
    if (
      (REMOVED_START_BLOCK_KEY_RE.test(key) && !localKeys.has(key)) ||
      ADDRESS_KEY_RE.test(key)
    ) {
      return { reason: "removed_env_key", key };
    }
  }
  if (isSet(env.DATABASE_SCHEMA)) {
    return { reason: "database_schema_override", key: "DATABASE_SCHEMA" };
  }
  for (const key of setKeys) {
    if (localKeys.has(key)) return { reason: "local_mode_set", key };
  }
  return null;
}
