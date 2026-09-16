/**
 * U9.1 / U9.1-fix product-send door — extract from harness source (no line cites)
 * plus behavioural proofs for the chain guard, slot extract, and wire≡plan.
 * Plants are in-memory only (never write under scripts/).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  CONFIRMED_SLOT_ABSENT,
  EVM_ARM_UNREACHABLE,
  WIRE_PLAN_MISMATCH,
  WRONG_WALLET_STANDARD_CHAIN,
  assertWireContainsPlan,
  createNodeSvmSignAndSendPort,
  requireConfirmedSlot,
  type NodeSvmSignAndSendPort,
} from "../scripts/svm-devnet-product-send.ts";
import { mintWalletStandardChain } from "../lib/web3/wallet-standard-chain.ts";
import type { WalletStandardChain } from "../lib/web3/wallet-standard-chain.ts";
import type { SvmSignAndSendPort } from "../lib/web3/svm-write-adapter.ts";
import { AccountRole } from "../lib/web3/svm-write-adapter.ts";
import { POLICY_SCAN_ROOT } from "./policy-scan-helpers.ts";

const ROOT = POLICY_SCAN_ROOT;
const DOOR_REL = "scripts/svm-devnet-product-send.ts";

const labRequire = createRequire(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../svm/lab/package.json"),
);
const { Keypair } = labRequire(
  "@solana/web3.js",
) as typeof import("@solana/web3.js");

export type ProductSendDoorDerivation = {
  executeSetPassportUriCalls: number;
  planSetPassportUriCalls: number;
  transactionInstructionNews: number;
  encodeSvmInstructionCalls: number;
  deriveSvmPdaCalls: number;
  sendSvmInstructionCalls: number;
  writeEvmContractThrowsNamed: boolean;
  inventsConfirmedSlotZero: boolean;
};

/**
 * Extract product-send door facts from source text — never a line-number citation.
 * Chain refusal is proved behaviourally (not here).
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
    inventsConfirmedSlotZero:
      /slot\s*\?\?\s*0\b/.test(source) ||
      /BigInt\(\s*row\?\.slot\s*\?\?\s*0\s*\)/.test(source),
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
    facts.inventsConfirmedSlotZero,
    false,
    "product-send must not invent confirmed_slot via slot ?? 0",
  );
}

/**
 * Expected chain must get past the wrong_wallet_standard_chain guard.
 * Invalid wire then fails on deserialize — a different failure class.
 */
export async function assertExpectedChainPassesGuard(
  port: SvmSignAndSendPort,
  expected: WalletStandardChain,
): Promise<void> {
  const garbage = new Uint8Array([1, 2, 3, 4, 5]);
  try {
    await port.signAndSendTransaction({
      transaction: garbage,
      chain: expected,
    });
    assert.fail(
      "expected chain must not succeed on invalid wire (guard-pass proof incomplete)",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert.doesNotMatch(
      message,
      /wrong_wallet_standard_chain/,
      "expected chain must get past wrong_wallet_standard_chain guard",
    );
  }
}

export async function assertForeignChainRefused(
  port: SvmSignAndSendPort,
  foreign: WalletStandardChain,
): Promise<void> {
  await assert.rejects(
    () =>
      port.signAndSendTransaction({
        transaction: new Uint8Array([0]),
        chain: foreign,
      }),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes(WRONG_WALLET_STANDARD_CHAIN),
    "foreign chain must refuse naming wrong_wallet_standard_chain",
  );
}

/** Inverted plant: refuses the correct chain (accepts foreign). */
export function createInvertedChainPort(
  expected: WalletStandardChain,
): SvmSignAndSendPort {
  return {
    async signAndSendTransaction({ chain }) {
      if (chain === expected) {
        throw new Error(
          `${WRONG_WALLET_STANDARD_CHAIN}: expected ${expected}, received ${chain}`,
        );
      }
      return new Uint8Array(64);
    },
  };
}

describe("svm-devnet-product-send door policy", () => {
  it("exports named refusal tokens", () => {
    assert.equal(EVM_ARM_UNREACHABLE, "evm_arm_unreachable");
    assert.equal(WRONG_WALLET_STANDARD_CHAIN, "wrong_wallet_standard_chain");
    assert.equal(CONFIRMED_SLOT_ABSENT, "confirmed_slot_absent");
    assert.equal(WIRE_PLAN_MISMATCH, "wire_plan_mismatch");
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
      inventsConfirmedSlotZero: false,
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

  it("planted slot ?? 0 invent is red then green (in-memory)", () => {
    const live = readFileSync(join(ROOT, DOOR_REL), "utf8");
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));

    const plant = live.replace(
      /return requireConfirmedSlot\(row\?\.slot\);/,
      "return BigInt(row?.slot ?? 0);",
    );
    assert.notEqual(plant, live, "slot-invent plant must differ from live source");
    assert.throws(
      () => assertProductSendDoorClass(deriveProductSendDoorFacts(plant)),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /must not invent confirmed_slot/.test(String(err.message)),
    );
    assertProductSendDoorClass(deriveProductSendDoorFacts(live));
  });
});

describe("svm-devnet-product-send chain refusal behaviour", () => {
  const expected = mintWalletStandardChain("solana:devnet");
  const foreign = mintWalletStandardChain("solana:mainnet");

  it("foreign chain refuses by name; expected chain gets past guard", async () => {
    const port = createNodeSvmSignAndSendPort({
      owner: Keypair.generate(),
      rpcUrl: "http://127.0.0.1:9",
      expectedChain: expected,
    });
    await assertForeignChainRefused(port, foreign);
    await assertExpectedChainPassesGuard(port, expected);
  });

  it("inverted comparison plant is red on expected-chain-passes-guard", async () => {
    const live = createNodeSvmSignAndSendPort({
      owner: Keypair.generate(),
      rpcUrl: "http://127.0.0.1:9",
      expectedChain: expected,
    });
    const plant = createInvertedChainPort(expected);
    assert.notEqual(plant, live, "inverted plant must differ from live port");

    await assertExpectedChainPassesGuard(live, expected);

    await assert.rejects(
      () => assertExpectedChainPassesGuard(plant, expected),
      (err: unknown) =>
        err instanceof assert.AssertionError &&
        /expected chain must get past wrong_wallet_standard_chain guard/.test(
          String(err.message),
        ),
      "inverted === plant must fail expected-chain-passes-guard",
    );

    await assertExpectedChainPassesGuard(live, expected);
  });
});

describe("svm-devnet-product-send confirmed slot", () => {
  it("requireConfirmedSlot returns bigint; absent refuses by name", () => {
    assert.equal(requireConfirmedSlot(42), 42n);
    assert.equal(requireConfirmedSlot(99n), 99n);
    assert.throws(
      () => requireConfirmedSlot(null),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(CONFIRMED_SLOT_ABSENT),
    );
    assert.throws(
      () => requireConfirmedSlot(undefined),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(CONFIRMED_SLOT_ABSENT),
    );
  });
});

describe("svm-devnet-product-send wire≡plan", () => {
  it("assertWireContainsPlan green when data and pubkeys embedded; omit account red", () => {
    const program = Keypair.generate().publicKey;
    const accountA = Keypair.generate().publicKey;
    const accountB = Keypair.generate().publicKey;
    const data = new Uint8Array([9, 8, 7, 6, 5, 4]);

    const wire = new Uint8Array([
      ...program.toBytes(),
      ...accountA.toBytes(),
      ...accountB.toBytes(),
      ...data,
      0xaa,
    ]);

    const plan = {
      programId: program.toBase58(),
      data,
      accounts: [
        { address: accountA.toBase58(), role: AccountRole.WRITABLE_SIGNER },
        { address: accountB.toBase58(), role: AccountRole.READONLY },
      ],
      feePayer: accountA.toBase58(),
    };

    assertWireContainsPlan(wire, plan);

    const missingB = new Uint8Array([
      ...program.toBytes(),
      ...accountA.toBytes(),
      ...data,
    ]);
    assert.throws(
      () => assertWireContainsPlan(missingB, plan),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes(WIRE_PLAN_MISMATCH) &&
        err.message.includes(accountB.toBase58()),
    );
  });

  it("live port records lastSignedTransaction on successful guard pass before deserialize", async () => {
    const expected = mintWalletStandardChain("solana:devnet");
    const port: NodeSvmSignAndSendPort = createNodeSvmSignAndSendPort({
      owner: Keypair.generate(),
      rpcUrl: "http://127.0.0.1:9",
      expectedChain: expected,
    });
    assert.equal(port.lastSignedTransaction, null);
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    try {
      await port.signAndSendTransaction({
        transaction: garbage,
        chain: expected,
      });
    } catch {
      // deserialize fails after record
    }
    assert.ok(port.lastSignedTransaction != null);
    assert.deepEqual(
      Array.from(port.lastSignedTransaction!),
      Array.from(garbage),
    );
  });
});
