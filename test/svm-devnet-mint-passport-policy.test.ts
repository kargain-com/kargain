/**
 * U9.0 / U9.0-fix mint door class — throw-site refusals, encode-traced ix data,
 * NEXT_TOKEN_ID_OFFSET pinned from PassportConfig field sizes in state.rs.
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
  NEXT_TOKEN_ID_OFFSET,
} from "../scripts/svm-devnet-mint-passport.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const DOOR_REL = "scripts/svm-devnet-mint-passport.ts";
const STATE_RS_REL = "svm/programs/kar-passport/src/state.rs";

const THROW_CAUSE_RE =
  /new\s+MintPassportRefusal\(\s*["']([a-z_]+)["']/g;

/** `data:` supplied by a byte-literal constructor (not encode result). */
const DATA_BYTE_LITERAL_RE =
  /data\s*:\s*(?:Buffer\.from\s*\(\s*\[|Buffer\.of\s*\(|Uint8Array\.from\s*\(\s*\[|Buffer\.alloc\s*\()/;

export type MintPassportDoorDerivation = {
  transactionInstructionNews: number;
  encodeSvmInstructionCalls: number;
  mintPassportVariantPins: number;
  deriveSvmPdaCalls: number;
  thrownRefusalCauses: string[];
  importsEvidenceWriter: boolean;
  importsOrNamesStaking: boolean;
  instructionDataFromEncode: boolean;
  instructionDataByteLiteral: boolean;
};

/**
 * Extract mint-door facts from source text — never a line-number citation.
 * Refusal causes come from THROW SITES only, not token presence.
 */
export function extractThrownRefusalCauses(source: string): string[] {
  const found: string[] = [];
  THROW_CAUSE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = THROW_CAUSE_RE.exec(source)) !== null) {
    found.push(m[1]!);
  }
  return [...new Set(found)].sort();
}

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

  const thrownRefusalCauses = extractThrownRefusalCauses(source);

  const importsEvidenceWriter =
    /svm-devnet-evidence-write/.test(source) ||
    /\bmergeAndWriteSvmDevnetEvidence\b/.test(source);

  const importsOrNamesStaking =
    /\bkarProStaking\b/.test(source) ||
    /\bstaking\.Join\b/.test(source) ||
    /kar-pro-staking/.test(source) ||
    /\bSetStakingProgram\b/.test(source);

  const instructionDataFromEncode =
    /\bconst\s+ixData\s*=\s*Buffer\.from\(\s*encoded\.data\s*\)/.test(source) &&
    /data\s*:\s*ixData\b/.test(source);

  const instructionDataByteLiteral = DATA_BYTE_LITERAL_RE.test(source);

  return {
    transactionInstructionNews,
    encodeSvmInstructionCalls,
    mintPassportVariantPins,
    deriveSvmPdaCalls,
    thrownRefusalCauses,
    importsEvidenceWriter,
    importsOrNamesStaking,
    instructionDataFromEncode,
    instructionDataByteLiteral,
  };
}

export function assertRefusalCausesBidirectional(
  thrown: readonly string[],
  declared: readonly string[],
): void {
  const thrownSet = new Set(thrown);
  const declaredSet = new Set(declared);
  const thrownWithoutUnion = thrown.filter((c) => !declaredSet.has(c));
  const declaredWithoutThrow = declared.filter((c) => !thrownSet.has(c));
  // thrown-without-union first so a renamed cause plant hits that named assertion
  assert.deepEqual(
    thrownWithoutUnion,
    [],
    `refusal thrown-without-union: ${thrownWithoutUnion.join(", ") || "(none)"}`,
  );
  assert.deepEqual(
    declaredWithoutThrow,
    [],
    `refusal declared-without-throw: ${declaredWithoutThrow.join(", ") || "(none)"}`,
  );
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
  assertRefusalCausesBidirectional(
    facts.thrownRefusalCauses,
    MINT_PASSPORT_REFUSAL_CAUSES,
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
    facts.instructionDataFromEncode,
    true,
    "mint door TransactionInstruction data must trace to encodeSvmInstruction result (ixData)",
  );
  assert.equal(
    facts.instructionDataByteLiteral,
    false,
    "mint door TransactionInstruction data must not be a byte-literal constructor",
  );
}

const FIXED_SIZE_VOCAB: Record<string, number> = {
  u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  u128: 16,
};

export type NextTokenIdOffsetCause =
  | "passport_config_struct_not_found"
  | "unsupported_passport_config_field_type"
  | "next_token_id_field_missing";

export class NextTokenIdOffsetRefusal extends Error {
  readonly causeName: NextTokenIdOffsetCause;
  constructor(cause: NextTokenIdOffsetCause, detail: string) {
    super(`${cause}: ${detail}`);
    this.name = "NextTokenIdOffsetRefusal";
    this.causeName = cause;
  }
}

/**
 * Sum borsh sizes of PassportConfig fields declared before next_token_id.
 * Refuse by name — never default or skip unknown types.
 */
export function nextTokenIdOffsetFromPassportConfigSource(
  stateRs: string,
): number {
  const structMatch = stateRs.match(
    /pub\s+struct\s+PassportConfig\s*\{([\s\S]*?)\n\}/,
  );
  if (!structMatch) {
    throw new NextTokenIdOffsetRefusal(
      "passport_config_struct_not_found",
      "struct PassportConfig not located in state.rs",
    );
  }
  const body = structMatch[1]!;
  const fieldRe = /pub\s+(\w+)\s*:\s*([^,]+),/g;
  let offset = 0;
  let m: RegExpExecArray | null;
  let sawNext = false;
  while ((m = fieldRe.exec(body)) !== null) {
    const name = m[1]!;
    const typeRaw = m[2]!.trim();
    if (name === "next_token_id") {
      sawNext = true;
      break;
    }
    const arrayMatch = typeRaw.match(/^\[u8;\s*(\d+)\]$/);
    if (arrayMatch) {
      offset += Number(arrayMatch[1]);
      continue;
    }
    const scalar = FIXED_SIZE_VOCAB[typeRaw];
    if (scalar == null) {
      throw new NextTokenIdOffsetRefusal(
        "unsupported_passport_config_field_type",
        `field ${name}: ${typeRaw}`,
      );
    }
    offset += scalar;
  }
  if (!sawNext) {
    throw new NextTokenIdOffsetRefusal(
      "next_token_id_field_missing",
      "PassportConfig has no next_token_id field",
    );
  }
  return offset;
}

export function assertNextTokenIdOffsetPinned(
  stateRs: string,
  doorOffset: number,
): void {
  const fromRust = nextTokenIdOffsetFromPassportConfigSource(stateRs);
  assert.equal(
    doorOffset,
    fromRust,
    `NEXT_TOKEN_ID_OFFSET must equal PassportConfig prefix sum from state.rs (door=${doorOffset}, rust=${fromRust})`,
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

  it("live door derives a clean class", () => {
    const source = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const facts = deriveMintPassportDoorFacts(source);
    assertMintPassportDoorClass(facts);
  });

  it("empty derivation is red on one-instruction", () => {
    const empty: MintPassportDoorDerivation = {
      transactionInstructionNews: 0,
      encodeSvmInstructionCalls: 0,
      mintPassportVariantPins: 0,
      deriveSvmPdaCalls: 0,
      thrownRefusalCauses: [],
      importsEvidenceWriter: false,
      importsOrNamesStaking: false,
      instructionDataFromEncode: false,
      instructionDataByteLiteral: false,
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
    assert.throws(
      () => assertMintPassportDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /exactly one TransactionInstruction/.test(String(err.message)),
    );
    assertMintPassportDoorClass(liveFacts);
  });

  it("planted remove one throw site is red on declared-without-throw", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));

    const plant = live.replace(
      /throw new MintPassportRefusal\(\s*"token_exists",\s*`[^`]*`,\s*\);/,
      "/* planted: token_exists throw removed */",
    );
    assert.notEqual(plant, live, "remove-throw plant must differ from live");
    const plantFacts = deriveMintPassportDoorFacts(plant);
    assert.throws(
      () => assertMintPassportDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /declared-without-throw/.test(String(err.message)) &&
        /token_exists/.test(String(err.message)),
      "removed throw must fail refusal declared-without-throw",
    );
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));
  });

  it("planted rename thrown cause is red on thrown-without-union", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));

    const plant = live.replace(
      /throw new MintPassportRefusal\(\s*"authority_mismatch",/,
      'throw new MintPassportRefusal(\n      "not_a_declared_cause",',
    );
    assert.notEqual(plant, live, "rename-throw plant must differ from live");
    const plantFacts = deriveMintPassportDoorFacts(plant);
    assert.throws(
      () => assertMintPassportDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /thrown-without-union/.test(String(err.message)) &&
        /not_a_declared_cause/.test(String(err.message)),
      "renamed throw must fail refusal thrown-without-union",
    );
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));
  });

  it("planted byte-literal data: is red then green", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));

    const plant = live.replace(/data:\s*ixData/, "data: Buffer.from([2])");
    assert.notEqual(plant, live, "data-literal plant must differ from live");
    const plantFacts = deriveMintPassportDoorFacts(plant);
    assert.throws(
      () => assertMintPassportDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        (/trace to encodeSvmInstruction/.test(String(err.message)) ||
          /byte-literal constructor/.test(String(err.message))),
      "byte-literal data must fail data-provenance assertion",
    );
    assertMintPassportDoorClass(deriveMintPassportDoorFacts(live));
  });

  it("NEXT_TOKEN_ID_OFFSET equals PassportConfig prefix sum from state.rs", () => {
    const stateRs = readFileSync(join(ROOT, STATE_RS_REL), "utf8");
    assertNextTokenIdOffsetPinned(stateRs, NEXT_TOKEN_ID_OFFSET);
  });

  it("planted extra field before next_token_id is red on offset pin", () => {
    const live = readFileSync(join(ROOT, STATE_RS_REL), "utf8");
    assertNextTokenIdOffsetPinned(live, NEXT_TOKEN_ID_OFFSET);

    const plant = live.replace(
      /pub next_token_id: \[u8; 32\],/,
      "pub planted_extra: [u8; 32],\n    pub next_token_id: [u8; 32],",
    );
    assert.notEqual(plant, live, "offset plant must differ from live state.rs");
    assert.throws(
      () => assertNextTokenIdOffsetPinned(plant, NEXT_TOKEN_ID_OFFSET),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /NEXT_TOKEN_ID_OFFSET must equal PassportConfig prefix sum/.test(
          String(err.message),
        ),
      "extra field before next_token_id must fail offset pin",
    );
    assertNextTokenIdOffsetPinned(live, NEXT_TOKEN_ID_OFFSET);
  });

  it("planted evidence-writer import is red", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const plant = `import { mergeAndWriteSvmDevnetEvidence } from "./lib/svm-devnet-evidence-write.js";\n${live}`;
    assert.notEqual(plant, live);
    const facts = deriveMintPassportDoorFacts(plant);
    assert.throws(
      () => assertMintPassportDoorClass(facts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /evidence writer/.test(String(err.message)),
    );
  });

  it("offset extraction refuses unsupported field type by name", () => {
    const live = readFileSync(join(ROOT, STATE_RS_REL), "utf8");
    const plant = live.replace(
      /pub namespace: u128,/,
      "pub namespace: String,",
    );
    assert.notEqual(plant, live);
    assert.throws(
      () => nextTokenIdOffsetFromPassportConfigSource(plant),
      (err: unknown) =>
        err instanceof NextTokenIdOffsetRefusal &&
        err.causeName === "unsupported_passport_config_field_type",
    );
  });
});
