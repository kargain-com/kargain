/**
 * Sole InstructionError reader: structured discriminant only; ban message identity.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  failingProgramFromLogMessages,
  parseAttributedSvmLandedInstructionError,
  parseSvmLandedInstructionError,
  SVM_NATIVE_IX_ERRORS,
} from "@/lib/web3/svm-landed-error";
import { FIXTURE_SVM_STACK } from "./fixtures/commercial-svm-stack.ts";
import {
  countProductScanTargets,
  walkProductTsFiles,
} from "./policy-scan-helpers.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "lib/web3/svm-landed-error.ts";
const STAND_REFUSAL = "svm/stand/stand-tx-refusal.ts";

/** Banned identity patterns for InvalidSeeds / InstructionError classification. */
const BANNED_IDENTITY = [
  /\/InvalidSeeds\/[gimsuy]*/,
  /\.includes\s*\(\s*["']InvalidSeeds["']\s*\)/,
  /JSON\.stringify\s*\([^)]*\)\s*\.includes\s*\(/,
] as const;

function findBannedIdentity(src: string): string[] {
  const hits: string[] = [];
  for (const re of BANNED_IDENTITY) {
    if (re.test(src)) hits.push(re.source);
  }
  return hits;
}

describe("parseSvmLandedInstructionError", () => {
  it("native InvalidSeeds / AccountAlreadyInitialized / MRS with index", () => {
    assert.deepEqual(
      parseSvmLandedInstructionError({
        InstructionError: [1, "InvalidSeeds"],
      }),
      { kind: "native", name: "InvalidSeeds", index: 1 },
    );
    assert.deepEqual(
      parseSvmLandedInstructionError({
        InstructionError: [0, "AccountAlreadyInitialized"],
      }),
      { kind: "native", name: "AccountAlreadyInitialized", index: 0 },
    );
    assert.deepEqual(
      parseSvmLandedInstructionError({
        InstructionError: [3, "MissingRequiredSignature"],
      }),
      { kind: "native", name: "MissingRequiredSignature", index: 3 },
    );
    assert.deepEqual(SVM_NATIVE_IX_ERRORS, [
      "InvalidSeeds",
      "AccountAlreadyInitialized",
      "MissingRequiredSignature",
    ]);
  });

  it("bare Custom ordinal → custom_unattributed (not named without stack)", () => {
    assert.deepEqual(
      parseSvmLandedInstructionError({
        InstructionError: [0, { Custom: 144 }],
      }),
      {
        kind: "custom_unattributed",
        ordinal: 144,
        index: 0,
        failingProgram: null,
      },
    );
    assert.deepEqual(
      parseSvmLandedInstructionError({
        InstructionError: [0, { Custom: 999_999 }],
      }),
      {
        kind: "custom_unattributed",
        ordinal: 999_999,
        index: 0,
        failingProgram: null,
      },
    );
  });

  it("parseAttributedSvmLandedInstructionError: Kargain program → named; System → unattributed", () => {
    const err = { InstructionError: [0, { Custom: 144 }] };
    assert.deepEqual(
      parseAttributedSvmLandedInstructionError(
        err,
        FIXTURE_SVM_STACK.karPassport,
        FIXTURE_SVM_STACK,
      ),
      { kind: "custom", name: "InvalidReceiver", ordinal: 144, index: 0 },
    );
    assert.deepEqual(
      parseAttributedSvmLandedInstructionError(
        { InstructionError: [0, { Custom: 1 }] },
        "11111111111111111111111111111111",
        FIXTURE_SVM_STACK,
      ),
      {
        kind: "custom_unattributed",
        ordinal: 1,
        index: 0,
        failingProgram: "11111111111111111111111111111111",
      },
    );
  });

  it("failingProgramFromLogMessages: first Program failed line; ignore Program log; truncated → null", () => {
    assert.equal(
      failingProgramFromLogMessages([
        "Program log: ignored",
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1",
      ]),
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    assert.equal(
      failingProgramFromLogMessages([
        "Program log: Instruction: Mint",
        "Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr failed: foo",
      ]),
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    assert.equal(failingProgramFromLogMessages(["Log truncated"]), null);
    assert.equal(failingProgramFromLogMessages(null), null);
    assert.equal(failingProgramFromLogMessages([]), null);
  });

  it("non-instruction TransactionError → null (never invent index)", () => {
    assert.equal(parseSvmLandedInstructionError({ InsufficientFundsForFee: null }), null);
    assert.equal(
      parseSvmLandedInstructionError(new Error("InvalidSeeds")),
      null,
    );
    assert.equal(
      parseSvmLandedInstructionError(
        JSON.stringify({ InstructionError: [0, "InvalidSeeds"] }),
      ),
      null,
    );
  });
});

describe("stand + product consume lib reader", () => {
  it("stand-tx-refusal imports parseSvmLandedInstructionError; no local InstructionError body", () => {
    const src = readFileSync(path.join(ROOT, STAND_REFUSAL), "utf8");
    assert.match(src, /parseSvmLandedInstructionError/);
    assert.match(src, /svm-landed-error/);
    assert.doesNotMatch(
      src,
      /function\s+parseStandInstructionError\s*\(/,
    );
  });

  it("live product + stand trees ban InvalidSeeds regex/includes/JSON.stringify identity", () => {
    const violations: string[] = [];
    let scanned = 0;
    for (const file of walkProductTsFiles(ROOT)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (rel === OWNER) continue;
      const src = readFileSync(file, "utf8");
      scanned += 1;
      for (const h of findBannedIdentity(src)) {
        violations.push(`${rel}: ${h}`);
      }
    }
    assert.ok(scanned > 0, "product walk must read files");
    assert.equal(
      scanned,
      countProductScanTargets({ rootDir: ROOT, owners: [OWNER] }),
    );
    for (const rel of [
      STAND_REFUSAL,
      "svm/stand/live-product-mint.ts",
      "svm/stand/stand-tx-confirm.ts",
    ]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      for (const h of findBannedIdentity(src)) {
        violations.push(`${rel}: ${h}`);
      }
    }
    assert.deepEqual(violations, [], violations.join("\n"));
  });

  it("planted InvalidSeeds includes identity is red; live owner stays green", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "svm-landed-plant-"));
    const planted = path.join(dir, "plant.ts");
    writeFileSync(
      planted,
      `export function isInvalidSeeds(e: unknown): boolean {
  return String(e).includes("InvalidSeeds") || JSON.stringify(e).includes("InvalidSeeds");
}
`,
    );
    const plantedSrc = readFileSync(planted, "utf8");
    assert.ok(findBannedIdentity(plantedSrc).length >= 2, "plant must trip guard");
    const ownerSrc = readFileSync(path.join(ROOT, OWNER), "utf8");
    assert.deepEqual(findBannedIdentity(ownerSrc), []);
  });
});
