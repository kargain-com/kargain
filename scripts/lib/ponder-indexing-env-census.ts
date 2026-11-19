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

type EnvAliasInfo = {
  /** Parameter property (`constructor(private env = process.env)`): any use is opaque. */
  paramProp: boolean;
  /** Binding leaves the module via export. */
  exported: boolean;
};

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

function hasExportModifier(node: ts.Node): boolean {
  const mods =
    (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers ??
    undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isParameterProperty(param: ts.ParameterDeclaration): boolean {
  return !!param.modifiers?.some(
    (m) =>
      m.kind === ts.SyntaxKind.PublicKeyword ||
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.ReadonlyKeyword,
  );
}

function isProcessEnvBindingInit(node: ts.Node): boolean {
  if (ts.isParameter(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  if (ts.isVariableDeclaration(node) && node.initializer) {
    return initializerYieldsProcessEnv(node.initializer);
  }
  return false;
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

function resolveSymbol(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Symbol | undefined {
  let sym = checker.getSymbolAtLocation(node);
  if (!sym) return undefined;
  if (sym.flags & ts.SymbolFlags.Alias) {
    try {
      sym = checker.getAliasedSymbol(sym);
    } catch {
      // unresolved alias under noResolve — keep the local symbol
    }
  }
  return sym;
}

function declarationExportsBinding(
  decl: ts.Declaration,
  checker: ts.TypeChecker,
  sf: ts.SourceFile,
  symbol: ts.Symbol,
): boolean {
  if (ts.isVariableDeclaration(decl)) {
    const stmt = decl.parent?.parent;
    if (stmt && ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      return true;
    }
  }
  if (
    (ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl)) &&
    hasExportModifier(decl)
  ) {
    return false; // exporting the function/class is not exporting the env param
  }
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      if (resolveSymbol(checker, stmt.expression) === symbol) return true;
    }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        const local = resolveSymbol(checker, el.propertyName ?? el.name);
        if (local === symbol) return true;
      }
    }
  }
  return false;
}

function functionLikeFromSymbol(
  sym: ts.Symbol,
  sf: ts.SourceFile,
): FunctionLike | undefined {
  for (const d of sym.getDeclarations() ?? []) {
    if (d.getSourceFile() !== sf) continue;
    if (
      ts.isFunctionDeclaration(d) ||
      ts.isFunctionExpression(d) ||
      ts.isArrowFunction(d) ||
      ts.isMethodDeclaration(d) ||
      ts.isConstructorDeclaration(d)
    ) {
      return d;
    }
    if (
      ts.isVariableDeclaration(d) &&
      d.initializer &&
      (ts.isFunctionExpression(d.initializer) ||
        ts.isArrowFunction(d.initializer))
    ) {
      return d.initializer;
    }
  }
  return undefined;
}

function parameterIsEnvForwardTarget(
  param: ts.ParameterDeclaration,
  fn: FunctionLike,
): "direct" | "options" | null {
  if (
    param.initializer &&
    initializerYieldsProcessEnv(param.initializer) &&
    ts.isIdentifier(param.name)
  ) {
    return "direct";
  }
  if (
    ts.isIdentifier(param.name) &&
    bodyConsumesOptionsEnv(fn.body, param.name.text)
  ) {
    return "options";
  }
  return null;
}

function objectLiteralForwardsEnvAlias(
  arg: ts.Expression,
  aliases: Map<ts.Symbol, EnvAliasInfo>,
  checker: ts.TypeChecker,
): boolean {
  const u = unwrap(arg);
  if (!ts.isObjectLiteralExpression(u)) return false;
  for (const prop of u.properties) {
    if (ts.isShorthandPropertyAssignment(prop)) {
      const sym = resolveSymbol(checker, prop.name);
      if (sym && aliases.has(sym) && !aliases.get(sym)!.paramProp) return true;
    }
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "env"
    ) {
      const init = unwrap(prop.initializer);
      if (ts.isIdentifier(init)) {
        const sym = resolveSymbol(checker, init);
        if (sym && aliases.has(sym) && !aliases.get(sym)!.paramProp) return true;
      }
    }
  }
  return false;
}

function createScanProgram(
  file: string,
  source: string,
): { program: ts.Program; sf: ts.SourceFile } {
  const fileName = file.replace(/\\/g, "/");
  const options: ts.CompilerOptions = {
    noResolve: true,
    noLib: true,
    noEmit: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    jsx: fileName.endsWith(".tsx") ? ts.JsxEmit.React : undefined,
  };
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (name) =>
    name === fileName || name.replace(/\\/g, "/") === fileName ? sf : undefined;
  host.fileExists = (name) =>
    name === fileName || name.replace(/\\/g, "/") === fileName;
  host.readFile = (name) =>
    name === fileName || name.replace(/\\/g, "/") === fileName
      ? source
      : undefined;
  host.writeFile = () => {};
  const program = ts.createProgram({
    rootNames: [fileName],
    options,
    host,
  });
  const bound = program.getSourceFile(fileName);
  if (!bound) throw new Error(`scanProcessEnvReads: missing source file ${fileName}`);
  return { program, sf: bound };
}

function collectEnvAliases(
  sf: ts.SourceFile,
  checker: ts.TypeChecker,
): Map<ts.Symbol, EnvAliasInfo> {
  const aliases = new Map<ts.Symbol, EnvAliasInfo>();
  const consider = (
    decl: (ts.VariableDeclaration | ts.ParameterDeclaration) & {
      initializer?: ts.Expression;
    },
  ): void => {
    if (!decl.initializer || !decl.name || !ts.isIdentifier(decl.name)) return;
    if (!initializerYieldsProcessEnv(decl.initializer)) return;
    const sym = checker.getSymbolAtLocation(decl.name);
    if (!sym) return;
    const paramProp = ts.isParameter(decl) && isParameterProperty(decl);
    const exported = declarationExportsBinding(decl, checker, sf, sym);
    aliases.set(sym, { paramProp, exported });
  };
  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) consider(node);
    if (ts.isParameter(node)) consider(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return aliases;
}

function isDeclarationNamePosition(id: ts.Identifier): boolean {
  const p = id.parent;
  if (ts.isVariableDeclaration(p) && p.name === id) return true;
  if (ts.isParameter(p) && p.name === id) return true;
  if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) {
    return true;
  }
  if (ts.isFunctionDeclaration(p) && p.name === id) return true;
  if (ts.isClassDeclaration(p) && p.name === id) return true;
  if (ts.isMethodDeclaration(p) && p.name === id) return true;
  if (ts.isPropertyDeclaration(p) && p.name === id) return true;
  if (ts.isGetAccessorDeclaration(p) && p.name === id) return true;
  if (ts.isSetAccessorDeclaration(p) && p.name === id) return true;
  if (ts.isPropertyAssignment(p) && p.name === id) return true;
  return false;
}

/**
 * Every `process.env` occurrence in `source`, plus named reads on bindings
 * initialised from `process.env`. Scoping and shadowing come from the
 * TypeScript binder (`createProgram` + `getSymbolAtLocation`), not a hand
 * scope stack. Destructuring yields named keys (or opaque for
 * rest/computed/nested). Any other alias use is opaque, except same-file
 * forwarding to a callee whose matching parameter is itself an env binding.
 */
export function scanProcessEnvReads(
  file: string,
  source: string,
): ProcessEnvRead[] {
  const { program, sf } = createScanProgram(file, source);
  const checker = program.getTypeChecker();
  const aliases = collectEnvAliases(sf, checker);
  const out: ProcessEnvRead[] = [];

  function reportOpaque(node: ts.Node): void {
    out.push({ file, line: lineOf(sf, node), kind: "opaque" });
  }

  // Exported / parameter-property env bindings escape without a later use.
  for (const [sym, info] of aliases) {
    if (!info.exported && !info.paramProp) continue;
    for (const d of sym.getDeclarations() ?? []) {
      if (d.getSourceFile() === sf) {
        reportOpaque(d);
        break;
      }
    }
  }

  function aliasInfoForExpr(
    expr: ts.Expression,
  ): { sym: ts.Symbol; info: EnvAliasInfo } | undefined {
    const e = unwrap(expr);
    if (ts.isIdentifier(e)) {
      const sym = resolveSymbol(checker, e);
      if (!sym) return undefined;
      const info = aliases.get(sym);
      return info ? { sym, info } : undefined;
    }
    // this.env — property from a parameter property
    if (
      ts.isPropertyAccessExpression(e) &&
      e.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const sym = resolveSymbol(checker, e.name);
      if (!sym) return undefined;
      const info = aliases.get(sym);
      return info ? { sym, info } : undefined;
    }
    return undefined;
  }

  function isSameFileEnvForward(
    call: ts.CallExpression,
    arg: ts.Expression,
  ): boolean {
    const calleeExpr = unwrap(call.expression);
    if (!ts.isIdentifier(calleeExpr)) return false;
    const calleeSym = resolveSymbol(checker, calleeExpr);
    if (!calleeSym) return false;
    const fn = functionLikeFromSymbol(calleeSym, sf);
    if (!fn) return false;
    const idx = call.arguments.indexOf(arg);
    if (idx < 0 || idx >= fn.parameters.length) return false;
    const kind = parameterIsEnvForwardTarget(fn.parameters[idx]!, fn);
    if (!kind) return false;
    if (kind === "direct") {
      const u = unwrap(arg);
      if (!ts.isIdentifier(u)) return false;
      const hit = aliasInfoForExpr(u);
      return !!hit && !hit.info.paramProp;
    }
    return objectLiteralForwardsEnvAlias(arg, aliases, checker);
  }

  function classifyEnvSourceUse(
    sourceExpr: ts.Expression,
    envNode: ts.Node,
    info: EnvAliasInfo | undefined,
  ): void {
    if (info?.paramProp) {
      reportOpaque(envNode);
      return;
    }
    const parent = sourceExpr.parent;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === sourceExpr
    ) {
      pushNamedAccess(out, file, sf, parent);
      return;
    }
    if (
      ts.isElementAccessExpression(parent) &&
      parent.expression === sourceExpr
    ) {
      pushNamedAccess(out, file, sf, parent);
      return;
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === sourceExpr &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      // Destructuring from alias — keys emitted by the declaration walk.
      return;
    }
    if (isQuietProcessEnvBindingSite(sourceExpr)) return;

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

  function visit(node: ts.Node): void {
    // Destructuring from process.env or from an env alias
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (
        ts.isObjectBindingPattern(node.name) &&
        initializerYieldsProcessEnv(node.initializer)
      ) {
        destructureObjectPattern(node.name, file, sf, out);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        aliasInfoForExpr(node.initializer) &&
        !aliasInfoForExpr(node.initializer)!.info.paramProp
      ) {
        destructureObjectPattern(node.name, file, sf, out);
      }
    }

    // Named access on an env alias (env.KEY / this.env when not param-prop path)
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      aliasInfoForExpr(node.expression)
    ) {
      const hit = aliasInfoForExpr(node.expression)!;
      if (hit.info.paramProp) {
        reportOpaque(node);
      } else {
        pushNamedAccess(out, file, sf, node);
      }
      // Still walk children except the alias expression (avoid bare opaque).
      if (ts.isPropertyAccessExpression(node)) visit(node.name);
      else visit(node.argumentExpression);
      return;
    }

    // Bare alias identifier (value position)
    if (ts.isIdentifier(node) && !isDeclarationNamePosition(node)) {
      const sym = resolveSymbol(checker, node);
      const info = sym ? aliases.get(sym) : undefined;
      if (info) {
        const parent = node.parent;
        if (
          (ts.isPropertyAccessExpression(parent) &&
            parent.expression === node) ||
          (ts.isElementAccessExpression(parent) && parent.expression === node)
        ) {
          // handled by access branch
        } else if (
          ts.isVariableDeclaration(parent) &&
          parent.initializer === node &&
          ts.isObjectBindingPattern(parent.name)
        ) {
          // handled by destructure
        } else {
          classifyEnvSourceUse(node, node, info);
          return;
        }
      }
    }

    // Direct process.env
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "env" &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process"
    ) {
      classifyEnvSourceUse(node, node, undefined);
      return;
    }
    if (
      (ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)) &&
      isProcessEnvExpr(node) &&
      // Only handle wrappers whose immediate child walk would otherwise miss
      // the interesting parent (e.g. (process.env as T).D).
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node
      ) &&
      !(
        ts.isElementAccessExpression(node.parent) &&
        node.parent.expression === node
      )
    ) {
      // Let forEachChild reach the inner process.env for binding sites;
      // for cast.D the PropertyAccess parent is on the wrapper — handle here.
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      isProcessEnvExpr(node.expression)
    ) {
      pushNamedAccess(out, file, sf, node);
      visit(node.name);
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      isProcessEnvExpr(node.expression)
    ) {
      pushNamedAccess(out, file, sf, node);
      visit(node.argumentExpression);
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
