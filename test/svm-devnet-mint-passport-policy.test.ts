/**
 * U9.0 mint door class — one MintPassport instruction, product encode+derive,
 * named refusals, no evidence/staking side paths.
 *
 * Plants are in-memory only (never write under scripts/).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  MINT_PASSPORT_REFUSAL_CAUSES,
  MINT_PASSPORT_VARIANT,
  type MintPassportRefusalCause,
} from "../scripts/svm-devnet-mint-passport.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const DOOR_REL = "scripts/svm-devnet-mint-passport.ts";

/** Floor: compared derivation objects (causes + encode/derive/ix pins). */
const DERIVATION_OBJECT_FLOOR = 10;

export type MintPassportDoorDerivation = {
  transactionInstructionNews: number;
  encodeSvmInstructionCalls: number;
  mintPassportVariantPins: number;
  deriveSvmPdaCalls: number;
  refusalCauses: MintPassportRefusalCause[];
  importsEvidenceWriter: boolean;
  importsOrNamesStaking: boolean;
  handRolledMintTag: boolean;
};

/**
 * Extract mint-door facts from source text — never a line-number citation.
 */
export function deriveMintPassportDoorFacts(
  source: string,
): MintPassportDoorDerivation {
  const transactionInstructionNews = (
    source.match(/new\s+TransactionInstruction\s*\(/g) ?? []
  ).length;
  const encodeSvmInstructionCalls = (
    source.match(/\bencodeSvmInstruction\s*\(/g) ?? []
  ).length;
  const mintPassportVariantPins =
    (source.match(/\bMintPassport\b/g) ?? []).length +
    (source.match(/\bMINT_PASSPORT_VARIANT\b/g) ?? []).length;
  const deriveSvmPdaCalls = (source.match(/\bderiveSvmPda\s*\(/g) ?? []).length;

  const refusalCauses = MINT_PASSPORT_REFUSAL_CAUSES.filter((cause) =>
    source.includes(`"${cause}"`) || source.includes(`'${cause}'`) ||
    // cause appears as typed string in throw / union
    new RegExp(`\\b${cause}\\b`).test(source),
  );

  const importsEvidenceWriter =
    /svm-devnet-evidence-write/.test(source) ||
    /\bmergeAndWriteSvmDevnetEvidence\b/.test(source);

  const importsOrNamesStaking =
    /\bkarProStaking\b/.test(source) ||
    /\bstaking\.Join\b/.test(source) ||
    /kar-pro-staking/.test(source) ||
    /\bSetStakingProgram\b/.test(source);

  const handRolledMintTag = /Buffer\.from\(\s*\[\s*2\s*\]\s*\)/.test(source);

  return {
    transactionInstructionNews,
    encodeSvmInstructionCalls,
    mintPassportVariantPins,
    deriveSvmPdaCalls,
    refusalCauses,
    importsEvidenceWriter,
    importsOrNamesStaking,
    handRolledMintTag,
  };
}

export function assertMintPassportDoorClass(
  facts: MintPassportDoorDerivation,
): void {
  assert.equal(
    facts.transactionInstructionNews,
    1,
    "mint door must build exactly one TransactionInstruction",
  );
  assert.ok(
    facts.encodeSvmInstructionCalls >= 1,
    "mint door must call encodeSvmInstruction",
  );
  assert.ok(
    facts.mintPassportVariantPins >= 1,
    "mint door must name MintPassport / MINT_PASSPORT_VARIANT",
  );
  assert.ok(
    facts.deriveSvmPdaCalls >= 1,
    "mint door must call deriveSvmPda",
  );
  assert.equal(
    facts.refusalCauses.length,
    MINT_PASSPORT_REFUSAL_CAUSES.length,
    `mint door must name every refusal cause (${MINT_PASSPORT_REFUSAL_CAUSES.join(", ")})`,
  );
  assert.equal(
    facts.importsEvidenceWriter,
    false,
    "mint door must not import the evidence writer",
  );
  assert.equal(
    facts.importsOrNamesStaking,
    false,
    "mint door must not touch staking / SetStakingProgram",
  );
  assert.equal(
    facts.handRolledMintTag,
    false,
    "mint door must not hand-roll Buffer.from([2]) for MintPassport",
  );
}

function derivationObjectCount(facts: MintPassportDoorDerivation): number {
  return (
    1 + // transactionInstructionNews
    1 + // encodeSvmInstructionCalls
    1 + // mintPassportVariantPins
    1 + // deriveSvmPdaCalls
    facts.refusalCauses.length +
    1 + // importsEvidenceWriter
    1 + // importsOrNamesStaking
    1 // handRolledMintTag
  );
}

describe("svm-devnet-mint-passport door policy", () => {
  it("exports the six named refusal causes and MintPassport variant", () => {
    assert.deepEqual(
      [...MINT_PASSPORT_REFUSAL_CAUSES],
      [
        "invalid_owner",
        "config_not_found",
        "config_discriminator_mismatch",
        "config_too_short",
        "authority_mismatch",
        "token_exists",
      ],
    );
    assert.equal(MINT_PASSPORT_VARIANT, "MintPassport");
  });

  it("live door derives a clean class with a floor object count", () => {
    const source = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const facts = deriveMintPassportDoorFacts(source);
    assertMintPassportDoorClass(facts);
    const compared = derivationObjectCount(facts);
    assert.ok(
      compared >= DERIVATION_OBJECT_FLOOR,
      `derivation compared ${compared} objects; floor is ${DERIVATION_OBJECT_FLOOR}`,
    );
  });

  it("empty derivation is red", () => {
    const empty: MintPassportDoorDerivation = {
      transactionInstructionNews: 0,
      encodeSvmInstructionCalls: 0,
      mintPassportVariantPins: 0,
      deriveSvmPdaCalls: 0,
      refusalCauses: [],
      importsEvidenceWriter: false,
      importsOrNamesStaking: false,
      handRolledMintTag: false,
    };
    assert.throws(
      () => assertMintPassportDoorClass(empty),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /exactly one TransactionInstruction/.test(String(err.message)),
      "empty derivation must fail the one-instruction assertion",
    );
  });

  it("planted second instruction is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const liveFacts = deriveMintPassportDoorFacts(live);
    assertMintPassportDoorClass(liveFacts);

    const plant = `${live}\nconst __planted = new TransactionInstruction({ programId: x, keys: [], data: Buffer.alloc(0) });\n`;
    assert.notEqual(plant, live, "plant must differ from live door source");
    const plantFacts = deriveMintPassportDoorFacts(plant);
    assert.equal(
      plantFacts.transactionInstructionNews,
      2,
      "plant must show two TransactionInstruction constructions",
    );
    assert.throws(
      () => assertMintPassportDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /exactly one TransactionInstruction/.test(String(err.message)),
      "plant with a second instruction must fail as AssertionError naming one-instruction",
    );

    assertMintPassportDoorClass(liveFacts);
  });

  it("planted evidence-writer import is red", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const plant = `import { mergeAndWriteSvmDevnetEvidence } from "./lib/svm-devnet-evidence-write.js";\n${live}`;
    const facts = deriveMintPassportDoorFacts(plant);
    assert.throws(
      () => assertMintPassportDoorClass(facts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /evidence writer/.test(String(err.message)),
    );
  });
});
