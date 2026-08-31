/**
 * LIVE stand proof returns must be chain observations — not expected constants.
 *
 * Rule (WORKING-METHOD §1 / §6): a value returned by a validator proof for the
 * outer suite to assert must come from a chain read in that proof. Expected
 * scenario constants (`PHASE.*`, `ERR.*`, boolean/number literals, pubkey
 * strings taken only from Keypair/PDA) belong in the proof's internal asserts.
 *
 * Scope: `svm/stand/live-*.ts` modules that `test/svm-stand.test.ts` imports.
 * Pin the rule on the final returned object shape — not one forbidden spelling.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAND_TEST = path.join(ROOT, "test/svm-stand.test.ts");
const STAND_DIR = path.join(ROOT, "svm/stand");

/** Expected-catalog identifiers — not chain observations. */
const EXPECTED_CATALOGS = new Set(["PHASE", "ERR"]);

function liveProofModulesFromStandTest(): string[] {
  const src = fs.readFileSync(STAND_TEST, "utf8");
  const re =
    /from\s+["']\.\.\/svm\/stand\/(live-[^"']+)\.ts["']/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(path.join(STAND_DIR, `${m[1]}.ts`));
  }
  return out;
}

/**
 * Find object-literal returns that look like proof result envelopes
 * (properties nested or top-level used by the outer suite).
 */
function collectReturnObjectLiterals(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression)) {
      // Skip tiny helper returns (e.g. { owner, approved } with ≤3 shorthand props
      // that are clearly parse helpers — still scan; helpers returning literals fail too.
      found.push(node.expression);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function exprIsBanned(expr: ts.Expression, sourceFile: ts.SourceFile): string | null {
  if (
    ts.isNumericLiteral(expr) ||
    ts.isStringLiteral(expr) ||
    ts.isNoSubstitutionTemplateLiteral(expr) ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return `literal ${expr.getText(sourceFile)}`;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const root = expr.expression;
    if (ts.isIdentifier(root) && EXPECTED_CATALOGS.has(root.text)) {
      return `expected-catalog ${expr.getText(sourceFile)}`;
    }
    // foo.toBase58() in the return — must bind observation first
    if (expr.name.text === "toBase58") {
      return `toBase58 in return (${expr.getText(sourceFile)}) — bind a chain-read variable first`;
    }
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression)) {
    if (expr.expression.name.text === "toBase58") {
      return `toBase58() in return — bind a chain-read variable first`;
    }
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const inner = exprIsBanned(prop.initializer, sourceFile);
        if (inner) return inner;
      }
    }
  }
  return null;
}

function scanProofReturns(filePath: string): string[] {
  const text = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: string[] = [];
  for (const obj of collectReturnObjectLiterals(sourceFile)) {
    // Only flag returns that look like proof envelopes (have nested objects or
    // many properties). Helper returns like `{ owner, approved }` are shorthand
    // and skip; `{ cu, signature }` with only identifiers also skip unless literals.
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const bad = exprIsBanned(prop.initializer, sourceFile);
      if (bad) {
        const name = prop.name.getText(sourceFile);
        const { line } = sourceFile.getLineAndCharacterOfPosition(prop.getStart(sourceFile));
        violations.push(`${path.relative(ROOT, filePath)}:${line + 1} property ${name}: ${bad}`);
      }
    }
  }
  return violations;
}

/** Constructed dirty fixture — must fail the scanner. */
const DIRTY_FIXTURE = `
export async function runDirtyProof() {
  const PHASE = { Offered: 1 };
  const ERR = { BelowFloor: 57 };
  const custodyPda = { toBase58: () => "ExpectedPda" };
  return {
    phase: 1,
    custodyOwner: custodyPda.toBase58(),
    belowFloor: ERR.BelowFloor,
    offered: PHASE.Offered,
    ok: true,
  };
}
`;

describe("svm-stand-live-proof-return-policy", () => {
  it("stand test imports at least one live-* proof module", () => {
    const mods = liveProofModulesFromStandTest();
    assert.ok(mods.length >= 3, `expected live-* imports, got ${mods.length}`);
    for (const m of mods) {
      assert.ok(fs.existsSync(m), `missing ${m}`);
    }
  });

  it("LIVE proof final returns have no expected-constant property values", () => {
    const mods = liveProofModulesFromStandTest();
    const all: string[] = [];
    for (const m of mods) {
      all.push(...scanProofReturns(m));
    }
    assert.equal(all.join("\n"), "", `expected-constant returns:\n${all.join("\n")}`);
  });

  it("constructed violation fails the scanner (both directions)", () => {
    const tmp = path.join(STAND_DIR, "_policy-dirty-fixture.ts");
    fs.writeFileSync(tmp, DIRTY_FIXTURE);
    try {
      const hits = scanProofReturns(tmp);
      assert.ok(hits.length >= 3, `dirty fixture must fail, got:\n${hits.join("\n")}`);
      assert.ok(hits.some((h) => h.includes("literal")), "must catch numeric/boolean literals");
      assert.ok(hits.some((h) => h.includes("toBase58")), "must catch toBase58 in return");
      assert.ok(
        hits.some((h) => h.includes("expected-catalog") || h.includes("ERR")),
        "must catch ERR/PHASE catalog",
      );
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("compliant observation return is accepted", () => {
    const tmp = path.join(STAND_DIR, "_policy-clean-fixture.ts");
    fs.writeFileSync(
      tmp,
      `
export async function runCleanProof() {
  const phaseFromLot = 1;
  const ownerFromAsset = "Abc";
  const belowFloorFromSim = 57;
  return { phase: phaseFromLot, custodyOwner: ownerFromAsset, belowFloor: belowFloorFromSim };
}
`,
    );
    try {
      assert.deepEqual(scanProofReturns(tmp), []);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
