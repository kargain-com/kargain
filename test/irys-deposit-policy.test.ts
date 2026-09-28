/**
 * Unit B — Irys deposit owner: no double-pay, no SDK fund(), pending record.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { SystemProgram, PublicKey } from "@solana/web3.js";

import {
  clearIrysDepositRecord,
  createMemoryIrysDepositRecordStore,
  irysDepositRecordKey,
  probeIrysDepositRecordStoreWritable,
  readIrysDepositRecord,
  writeIrysDepositRecord,
} from "../lib/storage/irys-deposit-record.ts";
import { postIrysBundlerDepositTx } from "../lib/storage/irys-bundler-deposit-post.ts";
import {
  ensureIrysDeposit,
  formatIrysUploadError,
  IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS,
  irysDepositCauseCopy,
  irysDepositNeededAmountForTests,
  IrysDepositRefusal,
  type IrysDepositPorts,
  type IrysDepositUploader,
} from "../lib/storage/irys-deposit.ts";
import {
  encodeSystemTransfer,
  SYSTEM_TRANSFER_IX_INDEX,
} from "../lib/svm/encode-system-transfer.ts";
import { systemProgramId } from "../lib/svm/foreign-programs.ts";
import { sendSvmInstruction } from "../lib/web3/svm-write-adapter.ts";
import type { ActiveAccount } from "../lib/web3/active-account.ts";
import { mintKargainNamespace } from "../lib/web3/kargain-namespace.ts";
import { requireCommercialActive } from "../lib/web3/commercial-active.ts";
import {
  assertCleanProductScan,
  scanProductSources,
} from "./policy-scan-helpers.ts";
import {
  FIXTURE_SVM_NAMESPACE,
  FIXTURE_SVM_STACK,
} from "./fixtures/commercial-svm-stack.ts";

const IRYS_CLIENT = "lib/storage/irys-client.ts";
const IRYS_DEPOSIT = "lib/storage/irys-deposit.ts";
const UPLOAD_META = "lib/passport/upload-passport-metadata.ts";

const EVM_STACK = requireCommercialActive(84532);

function evmAccount(): ActiveAccount {
  return {
    status: "connected",
    vm: "evm",
    address: "0x1111111111111111111111111111111111111111",
    namespace: mintKargainNamespace(84532),
    chainId: 84532,
  };
}

function svmAccount(): ActiveAccount {
  return {
    status: "connected",
    vm: "svm",
    address: "11111111111111111111111111111111",
  };
}

function fakeUploader(opts: {
  price: string;
  balance: string;
  bundler?: string;
  token?: string;
}): {
  uploader: IrysDepositUploader;
  setBalance: (v: string) => void;
} {
  let balance = opts.balance;
  return {
    setBalance: (v) => {
      balance = v;
    },
    uploader: {
      getPrice: async () => ({ toString: () => opts.price }),
      getBalance: async () => ({ toString: () => balance }),
      utils: {
        getBundlerAddress: async () =>
          opts.bundler ?? "Bundler1111111111111111111111111111111111",
      },
    },
  };
}

describe("irys deposit — pending record no double-pay", () => {
  it("fail after send → retry sends nothing, re-POSTs same id", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const { uploader, setBalance } = fakeUploader({
      price: "1000",
      balance: "0",
    });
    let sendCount = 0;
    let postIds: string[] = [];
    const ports: IrysDepositPorts = {
      store,
      sendEvmTransaction: {
        sendTransaction: async () => {
          sendCount += 1;
          return "0xabc123";
        },
      },
      readEvmAccountKind: async () => "eoa",
      waitEvmConfirmations: async () => {
        /* ok */
      },
      postBundlerDeposit: async ({ txId }) => {
        postIds.push(txId);
        return { statusClass: "not_seen_yet", httpStatus: 400 };
      },
    };

    const first = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(first.ok, false);
    if (first.ok) return;
    assert.equal(first.cause, "deposit_pending");
    assert.equal(sendCount, 1);
    assert.deepEqual(postIds, ["0xabc123"]);

    // Retry — must not send again
    postIds = [];
    const second = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(second.ok, false);
    assert.equal(sendCount, 1);
    assert.deepEqual(postIds, ["0xabc123"]);

    // Accept on third resolve
    ports.postBundlerDeposit = async ({ txId }) => {
      postIds.push(txId);
      setBalance("1000");
      return { statusClass: "accepted", httpStatus: 200 };
    };
    postIds = [];
    const third = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(third.ok, true);
    assert.equal(sendCount, 1);
  });

  it("SVM expired closes open record (new send allowed later)", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: "11111111111111111111111111111111",
      bundlerAddress: "Bundler1111111111111111111111111111111111",
    });
    writeIrysDepositRecord(store, key, {
      txId: "oldSig",
      amountBaseUnits: "100",
      createdAt: Date.now(),
      lastValidBlockHeight: "10",
    });
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    const r1 = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: svmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        confirmSvmFunding: {
          confirmSubmission: async () => ({
            kind: "expired",
            signature: "oldSig",
            lastValidBlockHeight: 10n,
            observedBlockHeight: 20n,
          }),
        },
      },
    });
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.cause, "deposit_pending");
    assert.equal(readIrysDepositRecord(store, key), null);
  });

  it("status_unknown keeps record", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: "11111111111111111111111111111111",
      bundlerAddress: "Bundler1111111111111111111111111111111111",
    });
    writeIrysDepositRecord(store, key, {
      txId: "sigUnknown",
      amountBaseUnits: "100",
      createdAt: Date.now(),
      lastValidBlockHeight: "999",
    });
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    const r = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: svmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        confirmSvmFunding: {
          confirmSubmission: async () => ({
            kind: "status_unknown",
            signature: "sigUnknown",
          }),
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.ok(readIrysDepositRecord(store, key));
  });

  it("POST 400 keeps; 200 and 202 close", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: "0x1111111111111111111111111111111111111111",
      bundlerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    writeIrysDepositRecord(store, key, {
      txId: "0xdead",
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader, setBalance } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    const keep = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async () => undefined,
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(keep.ok, false);
    assert.ok(readIrysDepositRecord(store, key));

    for (const httpStatus of [200, 202] as const) {
      writeIrysDepositRecord(store, key, {
        txId: `0xdead${httpStatus}`,
        amountBaseUnits: "100",
        createdAt: Date.now(),
      });
      setBalance("0");
      const closed = await ensureIrysDeposit({
        stack: EVM_STACK,
        account: evmAccount(),
        uploader,
        totalBytes: 100,
        paymentToken: "base-eth",
        bundlerUrl: "https://devnet.irys.xyz",
        ports: {
          store,
          waitEvmConfirmations: async () => undefined,
          postBundlerDeposit: async () => {
            setBalance("1000");
            return { statusClass: "accepted", httpStatus };
          },
        },
      });
      assert.equal(closed.ok, true, `http ${httpStatus}`);
      assert.equal(readIrysDepositRecord(store, key), null);
    }
  });

  it("balance ≥ price closes open record without send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: "0x1111111111111111111111111111111111111111",
      bundlerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    writeIrysDepositRecord(store, key, {
      txId: "0xold",
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "1000",
      bundler: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    let sent = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return "0xno";
          },
        },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(sent, false);
    assert.equal(readIrysDepositRecord(store, key), null);
  });

  it("unwritable store refuses before send", async () => {
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    let sent = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => undefined,
        },
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return "0xno";
          },
        },
        readEvmAccountKind: async () => "eoa",
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_record_unavailable");
    assert.equal(sent, false);
  });

  it("EVM contract wallet refuses before send", async () => {
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    let sent = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: createMemoryIrysDepositRecordStore(),
        readEvmAccountKind: async () => "contract",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return "0xno";
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_contract_wallet");
    assert.equal(sent, false);
  });

  it("expired closes then new send is allowed exactly once", async () => {
    // Use EVM path to avoid SVM kit assembly in this plant.
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: "0x1111111111111111111111111111111111111111",
      bundlerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    // Simulate expired by clearing (SVM expired clears). Then one send.
    writeIrysDepositRecord(store, key, {
      txId: "0xexpired",
      amountBaseUnits: "1",
      createdAt: 1,
    });
    clearIrysDepositRecord(store, key);
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    let sendCount = 0;
    const ports: IrysDepositPorts = {
      store,
      readEvmAccountKind: async () => "eoa",
      sendEvmTransaction: {
        sendTransaction: async () => {
          sendCount += 1;
          return "0xnew1";
        },
      },
      waitEvmConfirmations: async () => undefined,
      postBundlerDeposit: async () => ({
        statusClass: "not_seen_yet",
        httpStatus: 400,
      }),
    };
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(r.ok, false);
    assert.equal(sendCount, 1);
    await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(sendCount, 1);
  });
});

describe("irys deposit — wire + gates", () => {
  it("System transfer bytes ≡ SystemProgram.transfer", () => {
    const lamports = 1_234_567n;
    const encoded = encodeSystemTransfer(lamports);
    assert.equal(encoded.ok, true);
    if (!encoded.ok) return;
    const web3 = SystemProgram.transfer({
      fromPubkey: new PublicKey("11111111111111111111111111111111"),
      toPubkey: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
      lamports: Number(lamports),
    });
    assert.deepEqual(
      Buffer.from(encoded.data),
      Buffer.from(web3.data),
    );
    assert.equal(SYSTEM_TRANSFER_IX_INDEX, 2);
  });

  it("Kargain gate still refuses System program id", async () => {
    const r = await sendSvmInstruction({
      stack: FIXTURE_SVM_STACK,
      programId: systemProgramId(),
      data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
      accounts: [],
      feePayer: "11111111111111111111111111111111",
      port: {
        signAndSendTransaction: async () => new Uint8Array(64),
      },
      fetchBlockhash: async () => ({
        ok: true,
        value: { blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUqlTPUYFJm", lastValidBlockHeight: 1n },
      }),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "unregistered_program");
  });

  it("minConfirm pin is 5; invent plant would be wrong", () => {
    assert.equal(IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS, 5);
    const src = readFileSync(IRYS_DEPOSIT, "utf8");
    assert.match(src, /IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS\s*=\s*5/);
    assert.equal(/\bminConfirm(?:ations)?\s*=\s*1\b/.test(src), false);
  });

  it("deposit amount is ×1.1 only (no 1.2 gas multiplier)", () => {
    assert.equal(irysDepositNeededAmountForTests("1000", "0"), "1100");
    const client = readFileSync(IRYS_CLIENT, "utf8");
    assert.equal(/FUND_FEE_MULTIPLIER/.test(client), false);
    assert.equal(/\.fund\s*\(/.test(client), false);
  });

  it("no raw err.message in upload copy; wallet rejection named", () => {
    const meta = readFileSync(UPLOAD_META, "utf8");
    assert.equal(/err\.message\.includes/.test(meta), false);
    assert.equal(/return err\.message/.test(meta), false);
    assert.match(meta, /formatIrysUploadError/);
    assert.equal(
      formatIrysUploadError(new IrysDepositRefusal("deposit_pending")),
      irysDepositCauseCopy("deposit_pending"),
    );
  });

  it("product roots ban .fund( and submitFundTransaction — plant red→green", () => {
    const fundRe = /\.fund\s*\(|\bsubmitFundTransaction\b/;
    const scan = scanProductSources((text) =>
      fundRe.test(text) ? "sdk_fund_call" : false,
    );
    assertCleanProductScan(scan);

    const dirty = "await uploader.fund(needed, 1.2);\n";
    assert.match(dirty, fundRe);
  });

  it("bundler POST classifies status only", async () => {
    const posts: Array<{ status: number; expect: string }> = [
      { status: 200, expect: "accepted" },
      { status: 202, expect: "accepted" },
      { status: 400, expect: "not_seen_yet" },
      { status: 500, expect: "bundler_unavailable" },
    ];
    for (const row of posts) {
      const r = await postIrysBundlerDepositTx({
        bundlerUrl: "https://example.test",
        token: "solana",
        txId: "x",
        fetchImpl: async () =>
          new Response(null, { status: row.status }) as Response,
      });
      assert.equal(r.statusClass, row.expect);
    }
  });

  it("probe refuses when setItem throws", () => {
    assert.equal(
      probeIrysDepositRecordStoreWritable({
        getItem: () => null,
        setItem: () => {
          throw new Error("no");
        },
        removeItem: () => undefined,
      }),
      false,
    );
  });
});
