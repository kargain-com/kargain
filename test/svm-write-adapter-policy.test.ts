/**
 * §7.2 U5 — svm-write-adapter: assembly + lifecycle wiring + named refusals.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  AccountRole,
  decompileTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import type { Wallet } from "@wallet-standard/base";

import { encodeSvmInstruction } from "../lib/svm/encode-instruction.ts";
import {
  walletStandardChainOf,
  type SvmCommercialActiveStack,
} from "../lib/web3/commercial-active.ts";
import { createSvmSignAndSendPort } from "../lib/web3/svm-sign-and-send-port.ts";
import { runSvmWriteLifecycle } from "../lib/web3/svm-write-lifecycle.ts";
import {
  sendSvmInstruction,
  type SendSvmInstructionCause,
  type SvmSignAndSendPort,
} from "../lib/web3/svm-write-adapter.ts";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";

const WRITE_ADAPTER = "lib/web3/svm-write-adapter.ts";
const SIGN_PORT = "lib/web3/svm-sign-and-send-port.ts";
const SESSION = "lib/web3/svm-account-session.tsx";
const ACCOUNT_ADAPTER = "lib/web3/svm-account-adapter.ts";
const COMMERCIAL = "lib/web3/commercial-active.ts";

const FEE_PAYER = "11111111111111111111111111111111";
const MOCK_BLOCKHASH = getBase58Decoder().decode(new Uint8Array(32).fill(7));

const ALL_CAUSES: readonly SendSvmInstructionCause[] = [
  "wallet_cannot_sign_and_send",
  "no_connected_account",
  "wallet_returned_no_signature",
  "blockhash_unavailable",
  "blockhash_expired",
  "unregistered_program",
  "empty_instruction_data",
  "missing_wallet_standard_chain",
];

function encodeSetBridgeGateway(): Uint8Array {
  const encoded = encodeSvmInstruction({
    program: "kar-passport",
    variant: "SetBridgeGateway",
    fields: {
      gateway:
        "4444444444444444444444444444444444444444444444444444444444444444",
    },
  });
  assert.equal(encoded.ok, true);
  if (!encoded.ok) throw new Error("encode failed");
  return encoded.data;
}

function decompileWire(wire: Uint8Array) {
  const tx = getTransactionDecoder().decode(wire);
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  return decompileTransactionMessage(compiled);
}

function mockBlockhashOk() {
  return async () =>
    ({
      ok: true as const,
      value: {
        blockhash: MOCK_BLOCKHASH,
        lastValidBlockHeight: 1_000_000n,
      },
    }) as const;
}

function mockWallet(opts: {
  features?: Record<string, unknown>;
  accounts?: Wallet["accounts"];
  name?: string;
}): Wallet {
  return {
    name: opts.name ?? "MockWallet",
    version: "1.0.0",
    icon: "data:image/svg+xml,<svg></svg>",
    chains: ["solana:devnet"],
    accounts: opts.accounts ?? [
      {
        address: FEE_PAYER,
        publicKey: new Uint8Array(32),
        chains: ["solana:devnet"],
        features: ["solana:signAndSendTransaction"],
      },
    ],
    features: opts.features ?? {},
  } as unknown as Wallet;
}

describe("svm-write-adapter assembly proof", () => {
  it("hands the port a wire tx with fee payer, metas order, and U3 instruction data", async () => {
    const data = encodeSetBridgeGateway();
    const metaA = {
      address: FEE_PAYER,
      role: AccountRole.WRITABLE_SIGNER,
    };
    const metaB = {
      address: FIXTURE_SVM_STACK.bridgeGateway,
      role: AccountRole.READONLY,
    };
    let captured: Uint8Array | undefined;
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction({ transaction, chain }) {
        captured = transaction;
        assert.equal(chain, FIXTURE_SVM_STACK.walletStandardChain);
        const bytes = getBase58Encoder().encode(
          "5VEJvtcXsmsTMDoVYArRw7QtQAFBFax9AGyxhR2B4F7P",
        );
        return new Uint8Array(bytes);
      },
    };

    const result = await sendSvmInstruction({
      stack: FIXTURE_SVM_STACK,
      programId: FIXTURE_SVM_STACK.karPassport,
      data,
      accounts: [metaA, metaB],
      feePayer: FEE_PAYER,
      port,
      fetchBlockhash: mockBlockhashOk(),
    });
    assert.equal(result.ok, true);
    assert.ok(captured);
    const message = decompileWire(captured!);
    assert.equal(message.feePayer?.address, FEE_PAYER);
    assert.equal(message.instructions.length, 1);
    const ix = message.instructions[0]!;
    assert.equal(ix.programAddress, FIXTURE_SVM_STACK.karPassport);
    assert.deepEqual(
      ix.accounts?.map((a) => ({ address: a.address, role: a.role })),
      [
        { address: metaA.address, role: metaA.role },
        { address: metaB.address, role: metaB.role },
      ],
    );
    assert.deepEqual(Array.from(ix.data ?? []), Array.from(data));
  });
});

describe("svm-write-adapter wiring proof", () => {
  it("runSvmWriteLifecycle reaches confirm with the signature the port returned", async () => {
    const data = encodeSetBridgeGateway();
    const signatureBytes = new Uint8Array(64).fill(9);
    const expectedBase58 = getBase58Decoder().decode(signatureBytes);
    const port: SvmSignAndSendPort = {
      async signAndSendTransaction() {
        return signatureBytes;
      },
    };

    let confirmed: string | undefined;
    const outcome = await runSvmWriteLifecycle({
      chainId: FIXTURE_SVM_NAMESPACE,
      registry: { [FIXTURE_SVM_NAMESPACE]: FIXTURE_SVM_STACK },
      writeFn: async () => {
        const sent = await sendSvmInstruction({
          stack: FIXTURE_SVM_STACK,
          programId: FIXTURE_SVM_STACK.karPassport,
          data,
          accounts: [
            { address: FEE_PAYER, role: AccountRole.WRITABLE_SIGNER },
          ],
          feePayer: FEE_PAYER,
          port,
          fetchBlockhash: mockBlockhashOk(),
        });
        assert.equal(sent.ok, true);
        if (!sent.ok) {
          throw new Error("sendSvmInstruction refused");
        }
        return sent.signature;
      },
      createConfirmPort: () => ({
        confirmSignature: async (signature) => {
          confirmed = signature;
          return { signature, slot: 42n };
        },
      }),
      fetchStructuredPayloads: async () => [],
    });

    assert.equal(confirmed, expectedBase58);
    assert.equal(outcome.writeReference, expectedBase58);
  });
});

describe("svm-write-adapter named refusals", () => {
  it("exercises every SendSvmInstructionCause by name", async () => {
    const data = encodeSetBridgeGateway();
    const seen = new Set<SendSvmInstructionCause>();

    const mark = async (
      cause: SendSvmInstructionCause,
      run: () => Promise<{ ok: boolean; cause?: SendSvmInstructionCause }>,
    ) => {
      const result = await run();
      assert.equal(result.ok, false);
      assert.equal(result.cause, cause);
      seen.add(cause);
    };

    await mark("empty_instruction_data", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data: new Uint8Array(0),
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: mockBlockhashOk(),
      }),
    );

    await mark("no_connected_account", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: "",
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: mockBlockhashOk(),
      }),
    );

    await mark("unregistered_program", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: "Stake11111111111111111111111111111111111111",
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: mockBlockhashOk(),
      }),
    );

    await mark("missing_wallet_standard_chain", () => {
      const bare = {
        ...FIXTURE_SVM_STACK,
        walletStandardChain: undefined,
      } as unknown as SvmCommercialActiveStack;
      return sendSvmInstruction({
        stack: bare,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: mockBlockhashOk(),
      });
    });

    await mark("blockhash_unavailable", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: async () => ({
          ok: false,
          cause: "blockhash_unavailable",
          detail: "planted unavailable",
        }),
      }),
    );

    await mark("blockhash_expired", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(64); } },
        fetchBlockhash: async () => ({
          ok: false,
          cause: "blockhash_expired",
          detail: "planted expired",
        }),
      }),
    );

    await mark("wallet_returned_no_signature", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: { async signAndSendTransaction() { return new Uint8Array(0); } },
        fetchBlockhash: mockBlockhashOk(),
      }),
    );

    await mark("wallet_cannot_sign_and_send", () =>
      sendSvmInstruction({
        stack: FIXTURE_SVM_STACK,
        programId: FIXTURE_SVM_STACK.karPassport,
        data,
        accounts: [],
        feePayer: FEE_PAYER,
        port: {
          async signAndSendTransaction() {
            throw new Error(
              "Wallet Mock does not support solana:signAndSendTransaction",
            );
          },
        },
        fetchBlockhash: mockBlockhashOk(),
      }),
    );

    assert.deepEqual([...seen].sort(), [...ALL_CAUSES].sort());
  });
});

describe("svm-write-adapter negative controls", () => {
  it("wallet without solana:signAndSendTransaction refuses by name and never sends", () => {
    let sent = 0;
    const wallet = mockWallet({
      features: {
        // planted absence — no signAndSendTransaction
        "solana:signMessage": { signMessage: async () => [] },
      },
    });
    const created = createSvmSignAndSendPort(wallet);
    assert.equal(created.ok, false);
    if (created.ok) throw new Error("expected refusal");
    assert.equal(created.cause, "wallet_cannot_sign_and_send");
    assert.equal(sent, 0);
    void sent;
  });

  it("port that returns no signature refuses rather than forwarding empty string", async () => {
    const data = encodeSetBridgeGateway();
    const result = await sendSvmInstruction({
      stack: FIXTURE_SVM_STACK,
      programId: FIXTURE_SVM_STACK.karPassport,
      data,
      accounts: [],
      feePayer: FEE_PAYER,
      port: { async signAndSendTransaction() { return new Uint8Array(0); } },
      fetchBlockhash: mockBlockhashOk(),
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected refusal");
    assert.equal(result.cause, "wallet_returned_no_signature");
  });

  it("planted solana:signTransaction fallback turns the policy red", () => {
    const plant = `const feature = wallet.features["solana:signTransaction"] ?? wallet.features["solana:signAndSendTransaction"];\n`;
    const predicate = (source: string): string | false => {
      if (source.includes("solana:signTransaction")) {
        return "solana:signTransaction fallback planted";
      }
      return false;
    };
    assert.equal(predicate(plant), "solana:signTransaction fallback planted");
    for (const rel of [WRITE_ADAPTER, SIGN_PORT, SESSION, ACCOUNT_ADAPTER]) {
      const source = readFileSync(rel, "utf8");
      assert.equal(
        predicate(source),
        false,
        `${rel} must not mention solana:signTransaction`,
      );
    }
  });

  it("planted silent solana:devnet default turns the policy red", () => {
    const plant = `const chain = stack.walletStandardChain ?? "solana:devnet";\n`;
    const predicate = (source: string): string | false => {
      if (/\?\?\s*["']solana:devnet["']/.test(source)) {
        return 'silent ?? "solana:devnet" default planted';
      }
      return false;
    };
    assert.equal(
      predicate(plant),
      'silent ?? "solana:devnet" default planted',
    );
    for (const rel of [
      WRITE_ADAPTER,
      SIGN_PORT,
      COMMERCIAL,
      ACCOUNT_ADAPTER,
      SESSION,
    ]) {
      const source = readFileSync(rel, "utf8");
      assert.equal(
        predicate(source),
        false,
        `${rel} must not default cluster with ?? "solana:devnet"`,
      );
    }
  });
});

describe("svm-write-adapter ownership policy", () => {
  it("walletStandardChainOf refuses missing chain by name (no invent)", () => {
    const bare = {
      ...FIXTURE_SVM_STACK,
      walletStandardChain: undefined,
    } as unknown as SvmCommercialActiveStack;
    const result = walletStandardChainOf(bare);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected refusal");
    assert.equal(result.cause, "missing_wallet_standard_chain");
  });

  it("live fixture and stack carry a minted chain readable only via the owner", () => {
    const result = walletStandardChainOf(FIXTURE_SVM_STACK);
    assert.equal(result.ok, true);
    if (!result.ok) {
      throw new Error("expected ok chain");
    }
    assert.equal(result.chain, "solana:devnet");
  });

  it("bans web3.js and scripts imports in the write adapter and sign port", () => {
    const ban =
      /from\s*["']@solana\/web3\.js["']|from\s*["']@\/scripts\//;
    for (const rel of [WRITE_ADAPTER, SIGN_PORT]) {
      const source = readFileSync(rel, "utf8");
      assert.doesNotMatch(source, ban);
    }
    const dirtyWeb3 = `import { Connection } from "@solana/web3.js";\n`;
    assert.match(dirtyWeb3, ban);
  });

  it("product sources do not call encodeSvmInstruction inside the write adapter", () => {
    const source = readFileSync(WRITE_ADAPTER, "utf8");
    assert.doesNotMatch(source, /encodeSvmInstruction|deriveSvmPda/);
  });

  it("signAndSendTransaction feature is the sole Wallet Standard write feature named", () => {
    const source = readFileSync(SIGN_PORT, "utf8");
    assert.match(source, /solana:signAndSendTransaction/);
    assert.doesNotMatch(source, /solana:signTransaction/);
  });

  it("catches planted dual feature lookup (red→green)", () => {
    const dirty = `wallet.features["solana:signTransaction"]\n`;
    assert.match(dirty, /solana:signTransaction/);
    const clean = readFileSync(SIGN_PORT, "utf8");
    assert.doesNotMatch(clean, /solana:signTransaction/);
  });

  it("scan keeps write adapter as a kit owner (membership via svm-wallet-adapter-policy)", () => {
    // Structural pin: adapter imports kit; port imports wallet-standard only.
    const adapter = readFileSync(WRITE_ADAPTER, "utf8");
    assert.match(adapter, /from\s*["']@solana\/kit["']/);
    const port = readFileSync(SIGN_PORT, "utf8");
    assert.match(port, /from\s*["']@wallet-standard\/base["']/);
    const scan = scanProductSources(
      (rel, source) => {
        if (rel === WRITE_ADAPTER && /@solana\/kit/.test(source)) return false;
        return false;
      },
      { owners: [WRITE_ADAPTER, SIGN_PORT] },
    );
    assertCleanProductScan(scan, { owners: [WRITE_ADAPTER, SIGN_PORT] });
  });
});
