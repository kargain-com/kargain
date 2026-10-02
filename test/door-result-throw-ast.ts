/**
 * AST finder: ThrowStatement under a door-Result `!ok` branch is a violation.
 * Door = binding initialized from `resolveEvmChain(` or `evmWagmiChain(`.
 * Does not flag throws after `evmSwitchChainAvailability` (different binding).
 */

import ts from "typescript";

const DOOR_CALLEES = new Set(["resolveEvmChain", "evmWagmiChain"]);

function isDoorCall(expr: ts.Expression): boolean {
  if (ts.isAwaitExpression(expr)) return isDoorCall(expr.expression);
  if (ts.isParenthesizedExpression(expr)) return isDoorCall(expr.expression);
  if (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return isDoorCall(expr.expression);
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return DOOR_CALLEES.has(expr.expression.text);
  }
  return false;
}

function collectDoorBindings(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isDoorCall(node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

function isFalseLiteral(expr: ts.Expression): boolean {
  return expr.kind === ts.SyntaxKind.FalseKeyword;
}

function isTrueLiteral(expr: ts.Expression): boolean {
  return expr.kind === ts.SyntaxKind.TrueKeyword;
}

/** `!x.ok` or `x.ok === false` / `false === x.ok` */
function notOkDoorVar(
  expr: ts.Expression,
  doors: Set<string>,
): string | null {
  if (ts.isParenthesizedExpression(expr)) {
    return notOkDoorVar(expr.expression, doors);
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const okAccess = okPropertyAccess(expr.operand);
    if (okAccess && doors.has(okAccess)) return okAccess;
  }
  if (ts.isBinaryExpression(expr)) {
    if (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      const leftOk = okPropertyAccess(expr.left);
      const rightOk = okPropertyAccess(expr.right);
      if (leftOk && doors.has(leftOk) && isFalseLiteral(expr.right)) {
        return leftOk;
      }
      if (rightOk && doors.has(rightOk) && isFalseLiteral(expr.left)) {
        return rightOk;
      }
    }
  }
  return null;
}

/** `x.ok` or `x.ok === true` */
function okDoorVar(expr: ts.Expression, doors: Set<string>): string | null {
  if (ts.isParenthesizedExpression(expr)) {
    return okDoorVar(expr.expression, doors);
  }
  const direct = okPropertyAccess(expr);
  if (direct && doors.has(direct)) return direct;
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    const leftOk = okPropertyAccess(expr.left);
    if (leftOk && doors.has(leftOk) && isTrueLiteral(expr.right)) {
      return leftOk;
    }
    const rightOk = okPropertyAccess(expr.right);
    if (rightOk && doors.has(rightOk) && isTrueLiteral(expr.left)) {
      return rightOk;
    }
  }
  return null;
}

function okPropertyAccess(expr: ts.Expression): string | null {
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.name.text === "ok"
  ) {
    return expr.expression.text;
  }
  return null;
}

function collectThrows(
  stmt: ts.Statement,
  sf: ts.SourceFile,
  out: string[],
): void {
  const visit = (node: ts.Node) => {
    if (ts.isThrowStatement(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push(`door-result throw at line ${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(stmt);
}

/**
 * Returns human-readable violation strings for door-Result !ok throws.
 */
export function findDoorResultThrowViolations(
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
  const doors = collectDoorBindings(sf);
  if (doors.size === 0) return [];

  const violations: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const notOk = notOkDoorVar(node.expression, doors);
      if (notOk) {
        collectThrows(node.thenStatement, sf, violations);
      } else {
        const ok = okDoorVar(node.expression, doors);
        if (ok && node.elseStatement) {
          collectThrows(node.elseStatement, sf, violations);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}
