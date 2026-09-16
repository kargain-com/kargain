/**
 * U9.1 product-send door class — extract from harness source, never by line.
 * Plants are in-memory only (never write under scripts/).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  EVM_ARM_UNREACHABLE,
  WRONG_WALLET_STANDARD_CHAIN,
} from "../scripts/svm-devnet-product-send.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const DOOR_REL = "scripts/svm-devnet-product-send.ts";

export type ProductSendDoorDerivation = {
  executeSetPassportUriCalls: number;
  planSetPassportUriCalls: number;
  transactionInstructionNews: number;
  encodeSvmInstructionCalls: number;
  deriveSvmPdaCalls: number;
  sendSvmInstructionCalls: number;
  writeEvmContractThrowsNamed: boolean;
  wrongWalletStandardChainRefusal: boolean;
};

/**
 * Extract product-send door facts from source text — never a line-number citation.
 */
export function deriveProductSendDoorFacts(
  source: string,
): ProductSendDoorDerivation {
  return {
    executeSetPassportUriCalls: (
      source.match(/\bexecuteSetPassportUri\s*\(/g) ?? []
    ).length,
    planSetPassportUriCalls: (
      source.match(/\bplanSetPassportUri\s*\(/g) ?? []
    ).length,
    transactionInstructionNews: (
      source.match(/new\s+TransactionInstruction\s*\(/g) ?? []
    ).length,
    encodeSvmInstructionCalls: (
      source.match(/\bencodeSvmInstruction\s*\(/g) ?? []
    ).length,
    deriveSvmPdaCalls: (source.match(/\bderiveSvmPda\s*\(/g) ?? []).length,
    sendSvmInstructionCalls: (
      source.match(/\bsendSvmInstruction\s*\(/g) ?? []
    ).length,
    writeEvmContractThrowsNamed:
      /writeEvmContract\s*:\s*\(\)\s*=>\s*\{[\s\S]*?throw new Error\(\s*[`'"]\$\{?EVM_ARM_UNREACHABLE\}?/.test(
        source,
      ) ||
      (source.includes("writeEvmContract:") &&
        source.includes(EVM_ARM_UNREACHABLE) &&
        /throw new Error\(/.test(source) &&
        /writeEvmContract[\s\S]{0,400}evm_arm_unreachable/.test(source)),
    wrongWalletStandardChainRefusal:
      source.includes(WRONG_WALLET_STANDARD_CHAIN) &&
      /wrong_wallet_standard_chain/.test(source) &&
      /expected[\s\S]{0,80}received/.test(source),
  };
}

/** Count of boolean/number fields compared by {@link assertProductSendDoorClass}. */
export function productSendDoorAssertionFieldCount(
  facts: ProductSendDoorDerivation,
): number {
  return Object.keys(facts).length;
}

export function assertProductSendDoorClass(
  facts: ProductSendDoorDerivation,
): void {
  assert.ok(
    facts.executeSetPassportUriCalls >= 1,
    "product-send door must call executeSetPassportUri",
  );
  assert.ok(
    facts.planSetPassportUriCalls >= 1,
    "product-send door must call planSetPassportUri",
  );
  assert.equal(
    facts.transactionInstructionNews,
    0,
    "product-send door must not construct TransactionInstruction",
  );
  assert.equal(
    facts.encodeSvmInstructionCalls,
    0,
    "product-send door must not call encodeSvmInstruction",
  );
  assert.equal(
    facts.deriveSvmPdaCalls,
    0,
    "product-send door must not call deriveSvmPda",
  );
  assert.equal(
    facts.sendSvmInstructionCalls,
    0,
    "product-send door must not call sendSvmInstruction",
  );
  assert.equal(
    facts.writeEvmContractThrowsNamed,
    true,
    "product-send writeEvmContract must be a throwing stub naming evm_arm_unreachable",
  );
  assert.equal(
    facts.wrongWalletStandardChainRefusal,
    true,
    "product-send port must refuse wrong_wallet_standard_chain by name",
  );
}

describe("svm-devnet-product-send door policy", () => {
  it("exports named refusal tokens", () => {
    assert.equal(EVM_ARM_UNREACHABLE, "evm_arm_unreachable");
    assert.equal(WRONG_WALLET_STANDARD_CHAIN, "wrong_wallet_standard_chain");
  });

  it("live door derives a clean class; field count equals Object.keys length", () => {
    const source = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const facts = deriveProductSendDoorFacts(source);
    assertProductSendDoorClass(facts);
    const fieldCount = productSendDoorAssertionFieldCount(facts);
    assert.equal(
      fieldCount,
      Object.keys(facts).length,
      "comparison count must equal derived Object.keys length",
    );
    // Count is reported from Object.keys(facts) — never a hand-written floor.
    assert.ok(fieldCount > 0, "derivation must expose at least one field");
  });

  it("empty derivation is red on executeSetPassportUri", () => {
    const empty: ProductSendDoorDerivation = {
      executeSetPassportUriCalls: 0,
      planSetPassportUriCalls: 0,
      transactionInstructionNews: 0,
      encodeSvmInstructionCalls: 0,
      deriveSvmPdaCalls: 0,
      sendSvmInstructionCalls: 0,
      writeEvmContractThrowsNamed: false,
      wrongWalletStandardChainRefusal: false,
    };
    assert.throws(
      () => assertProductSendDoorClass(empty),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /must call executeSetPassportUri/.test(String(err.message)),
      "empty derivation must fail executeSetPassportUri assertion",
    );
  });

  it("planted TransactionInstruction assemble is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    const liveFacts = deriveProductSendDoorFacts(live);
    assertProductSendDoorClass(liveFacts);

    const plant = `${live}\nconst __planted = new TransactionInstruction({ programId: x, keys: [], data: Buffer.alloc(0) });\n`;
    assert.notEqual(plant, live, "assemble plant must differ from live source");
    const plantFacts = deriveProductSendDoorFacts(plant);
    assert.throws(
      () => assertProductSendDoorClass(plantFacts),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /must not construct TransactionInstruction/.test(String(err.message)),
    );
    assertProductSendDoorClass(liveFacts);
  });

  it("planted encodeSvmInstruction call is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));

    const plant = `${live}\nencodeSvmInstruction({ program: "kar-passport", variant: "SetPassportUri", fields: {} });\n`;
    assert.notEqual(plant, live, "encode plant must differ from live source");
    assert.throws(
      () => assertProductSendDoorClass(deriveProductSendDoorFacts(plant)),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /must not call encodeSvmInstruction/.test(String(err.message)),
    );
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));
  });

  it("planted port that accepts any chain is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));

    // Remove the wrong-chain refusal body — port accepts any chain.
    const plant = live.replace(
      /if \(chain !== opts\.expectedChain\) \{\s*throw new Error\(\s*`\$\{WRONG_WALLET_STANDARD_CHAIN\}: expected \$\{opts\.expectedChain\}, received \$\{chain\}`,\s*\);\s*\}/,
      "/* planted: any-chain accept */",
    );
    assert.notEqual(plant, live, "any-chain plant must differ from live source");
    assert.throws(
      () => assertProductSendDoorClass(deriveProductSendDoorFacts(plant)),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /wrong_wallet_standard_chain/.test(String(err.message)),
    );
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));
  });

  it("planted writeEvmContract without throw is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));

    const plant = live.replace(
      /writeEvmContract:\s*\(\)\s*=>\s*\{[\s\S]*?\},/,
      "writeEvmContract: async () => \"0xdead\" as `0x${string}`,",
    );
    assert.notEqual(
      plant,
      live,
      "writeEvmContract plant must differ from live source",
    );
    assert.throws(
      () => assertProductSendDoorClass(deriveProductSendDoorFacts(plant)),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /writeEvmContract must be a throwing stub/.test(String(err.message)),
    );
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));
  });
});
