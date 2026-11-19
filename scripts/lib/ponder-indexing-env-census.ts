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

/** Parameter default or declaration init that aliases `process.env`. */
function isProcessEnvBindingInit(node: ts.Node): boolean {
  if (ts.isParameter(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  if (ts.isVariableDeclaration(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  return false;
}

function pushNamedEnvAccess(
  out: ProcessEnvRead[],
  file: string,
  sf: ts.SourceFile,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): void {
  const line =
    sf.getLineAndCharacterOfPosition(access.getStart(sf)).line + 1;
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
 * Every `process.env` occurrence in `source`, plus named reads on bindings
 * initialised from `process.env` (parameter default `= process.env`, or
 * `x ?? process.env`). A read by literal key or by a template with a literal
 * head is named; any other use (passing the object, destructuring, a computed
 * key) is `opaque` and can never be classified.
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
  /** Nested scopes: identifier → aliases process.env. */
  const aliasStack: Array<Set<string>> = [new Set()];

  function aliasesEnv(name: string): boolean {
    for (let i = aliasStack.length - 1; i >= 0; i--) {
      if (aliasStack[i]!.has(name)) return true;
    }
    return false;
  }

  function withFunctionScope(
    params: readonly ts.ParameterDeclaration[],
    body: ts.Node | undefined,
  ): void {
    const scope = new Set<string>();
    for (const p of params) {
      if (
        p.initializer &&
        initializerYieldsProcessEnv(p.initializer) &&
        ts.isIdentifier(p.name)
      ) {
        scope.add(p.name.text);
      }
    }
    aliasStack.push(scope);
    if (body) visit(body);
    // Visit initializers (process.env defaults) without treating them as opaque.
    for (const p of params) {
      if (p.initializer) visit(p.initializer);
      if (p.type) visit(p.type);
    }
    aliasStack.pop();
  }

  function visit(node: ts.Node): void {
    // Named reads on an injected env binding.
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliasesEnv(node.expression.text)
    ) {
      pushNamedEnvAccess(out, file, sf, node);
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliasesEnv(node.expression.text)
    ) {
      pushNamedEnvAccess(out, file, sf, node);
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
      withFunctionScope(node.parameters, node.body);
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      initializerYieldsProcessEnv(node.initializer) &&
      ts.isIdentifier(node.name)
    ) {
      aliasStack[aliasStack.length - 1]!.add(node.name.text);
      visit(node.initializer);
      if (node.type) visit(node.type);
      return;
    }

    if (isProcessEnvExpr(node as ts.Expression) && ts.isExpression(node)) {
      const line =
        sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        out.push({ file, line, kind: "key", key: parent.name.text });
      } else if (
        ts.isElementAccessExpression(parent) &&
        parent.expression === node
      ) {
        const arg = unwrap(parent.argumentExpression);
        if (
          ts.isStringLiteral(arg) ||
          ts.isNoSubstitutionTemplateLiteral(arg)
        ) {
          out.push({ file, line, kind: "key", key: arg.text });
        } else if (ts.isTemplateExpression(arg) && arg.head.text.length > 0) {
          out.push({ file, line, kind: "prefix", prefix: arg.head.text });
        } else {
          out.push({ file, line, kind: "opaque" });
        }
      } else if (isProcessEnvBindingInit(parent)) {
        // Binding initialiser — named reads come from the alias.
      } else if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
        parent.right === node &&
        isProcessEnvBindingInit(parent.parent)
      ) {
        // `x ?? process.env` as a binding initialiser.
      } else {
        out.push({ file, line, kind: "opaque" });
      }
      return;
    }

    // Block scope for const/let aliases.
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      aliasStack.push(new Set());
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
