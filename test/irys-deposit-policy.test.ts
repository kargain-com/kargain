/**
 * Unit B2 — Irys deposit: three-state record + EVM replacement honesty.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { getBase58Decoder } from "@solana/kit";
import { SystemProgram, PublicKey } from "@solana/web3.js";

import {
  clearIrysDepositRecord,
  createMemoryIrysDepositRecordStore,
  irysDepositRecordKey,
  probeIrysDepositRecordStoreWritable,
  readIrysDepositRecord,
  writeIrysDepositRecord,
  type IrysDepositRecordStore,
  type IrysDepositStoreGetResult,
} from "../lib/storage/irys-deposit-record.ts";
import { postIrysBundlerDepositTx } from "../lib/storage/irys-bundler-deposit-post.ts";
import {
  ensureIrysDeposit,
  formatIrysUploadError,
  irysDepositCauseCopy,
  IrysDepositRefusal,
  IRYS_DEPOSIT_AMOUNT_DENOMINATOR,
  IRYS_DEPOSIT_AMOUNT_NUMERATOR,
  readIrysEvmMinConfirm,
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
const IRYS_DEPOSIT_RECORD = "lib/storage/irys-deposit-record.ts";
const EVM_TX_CONFIRM = "lib/web3/evm-tx-confirm.ts";
const EVM_WRITE_ADAPTER = "lib/web3/evm-write-adapter.ts";
const EVM_WRITE_LIFECYCLE = "lib/web3/evm-write-lifecycle.ts";
const UPLOAD_META = "lib/passport/upload-passport-metadata.ts";
const DEPOSIT_HOOK = "hooks/use-irys-deposit-ports.ts";

const EVM_STACK = requireCommercialActive(84532);
const ETH_STACK = requireCommercialActive(11155111);

/** Valid 32-byte EVM tx hashes (viem isHash). */
const HASH_A =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const HASH_B =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const HASH_C =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as const;

/** Valid 64-byte Ed25519 signature as base58 (kit codec). */
const SVM_SIG = getBase58Decoder().decode(new Uint8Array(64));

const EVM_PAYER = "0x1111111111111111111111111111111111111111";
const EVM_BUNDLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SVM_PAYER = "11111111111111111111111111111111";
const SVM_BUNDLER = "Bundler1111111111111111111111111111111111";

function evmAccount(chainId = 84532): ActiveAccount {
  return {
    status: "connected",
    vm: "evm",
    address: EVM_PAYER,
    namespace: mintKargainNamespace(chainId),
    chainId,
  };
}

function svmAccount(): ActiveAccount {
  return {
    status: "connected",
    vm: "svm",
    address: SVM_PAYER,
  };
}

function fakeUploader(opts: {
  price: string;
  balance: string;
  bundler?: string;
  minConfirm?: number | null;
}): {
  uploader: IrysDepositUploader;
  setBalance: (v: string) => void;
} {
  let balance = opts.balance;
  const uploader: IrysDepositUploader = {
    getPrice: async () => ({ toString: () => opts.price }),
    getBalance: async () => ({ toString: () => balance }),
    utils: {
      getBundlerAddress: async () => opts.bundler ?? EVM_BUNDLER,
    },
  };
  if (opts.minConfirm === null) {
    /* omit tokenConfig — deposit_unknown_token */
  } else {
    uploader.tokenConfig = { minConfirm: opts.minConfirm ?? 5 };
  }
  return {
    setBalance: (v) => {
      balance = v;
    },
    uploader,
  };
}

function rawSet(
  store: IrysDepositRecordStore,
  key: string,
  raw: string,
): void {
  store.setItem(key, raw);
}

/** ×1.1 amount via ensureIrysDeposit send value (no product test export). */
async function observedNeededAmount(
  price: string,
  balance: string,
): Promise<bigint> {
  const store = createMemoryIrysDepositRecordStore();
  const { uploader } = fakeUploader({ price, balance });
  let observed = 0n;
  await ensureIrysDeposit({
    stack: EVM_STACK,
    account: evmAccount(),
    uploader,
    totalBytes: 100,
    paymentToken: "base-eth",
    bundlerUrl: "https://devnet.irys.xyz",
    ports: {
      store,
      readEvmAccountKind: async () => "eoa",
      sendEvmTransaction: {
        sendTransaction: async ({ value }) => {
          observed = value;
          return HASH_A;
        },
      },
      waitEvmConfirmations: async () => ({ kind: "confirmed", hash: HASH_A }),
      postBundlerDeposit: async () => ({
        statusClass: "not_seen_yet",
        httpStatus: 400,
      }),
    },
  });
  return observed;
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
          return HASH_A;
        },
      },
      readEvmAccountKind: async () => "eoa",
      waitEvmConfirmations: async ({ txHash }) => ({
        kind: "confirmed",
        hash: txHash,
      }),
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
    assert.deepEqual(postIds, [HASH_A]);

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
    assert.deepEqual(postIds, [HASH_A]);

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

  it("SVM expired → deposit_expired; clears; new send allowed once", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: SVM_PAYER,
      bundlerAddress: SVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "svm",
      signature: SVM_SIG,
      lastValidBlockHeight: "10",
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: SVM_BUNDLER,
    });
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
            signature: SVM_SIG,
            lastValidBlockHeight: 10n,
            observedBlockHeight: 20n,
          }),
        },
      },
    });
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.cause, "deposit_expired");
    assert.equal(readIrysDepositRecord(store, key, "svm").kind, "absent");
    assert.match(irysDepositCauseCopy("deposit_expired"), /did not land/i);
  });

  it("status_unknown keeps record", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: SVM_PAYER,
      bundlerAddress: SVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "svm",
      signature: SVM_SIG,
      lastValidBlockHeight: "999",
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: SVM_BUNDLER,
    });
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
            signature: SVM_SIG,
          }),
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.equal(readIrysDepositRecord(store, key, "svm").kind, "record");
  });

  it("SVM record without lastValidBlockHeight → unreadable; no confirm; no send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: SVM_PAYER,
      bundlerAddress: SVM_BUNDLER,
    });
    // Legacy / corrupt: missing height — reader refuses as unreadable.
    rawSet(
      store,
      key,
      JSON.stringify({
        vm: "svm",
        signature: SVM_SIG,
        amountBaseUnits: "100",
        createdAt: Date.now(),
      }),
    );
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: SVM_BUNDLER,
    });
    let sent = 0;
    let confirmed = 0;
    const ports: IrysDepositPorts = {
      store,
      svmSignAndSend: {
        signAndSendTransaction: async () => {
          sent += 1;
          return new Uint8Array(64);
        },
      },
      confirmSvmFunding: {
        confirmSubmission: async () => {
          confirmed += 1;
          throw new Error("must not confirm without height");
        },
      },
    };
    const r1 = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: svmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(r1.ok, false);
    if (!r1.ok) {
      assert.equal(r1.cause, "deposit_record_unreadable");
      assert.equal(r1.txId, undefined);
    }
    assert.equal(readIrysDepositRecord(store, key, "svm").kind, "unreadable");
    assert.equal(sent, 0);
    assert.equal(confirmed, 0);

    const r2 = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: svmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports,
    });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.cause, "deposit_record_unreadable");
    assert.equal(sent, 0);
    assert.match(
      irysDepositCauseCopy("deposit_record_unreadable"),
      /Contact support\./,
    );
    assert.equal(
      /transaction unknown/.test(
        irysDepositCauseCopy("deposit_record_unreadable"),
      ),
      false,
    );
  });

  it("POST 400 keeps; 200 and 202 close", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader, setBalance } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
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
        waitEvmConfirmations: async ({ txHash }) => ({
          kind: "confirmed",
          hash: txHash,
        }),
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(keep.ok, false);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "record");

    for (const httpStatus of [200, 202] as const) {
      const hash = httpStatus === 200 ? HASH_B : HASH_C;
      writeIrysDepositRecord(store, key, {
        vm: "evm",
        txHash: hash,
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
          waitEvmConfirmations: async ({ txHash }) => ({
            kind: "confirmed",
            hash: txHash,
          }),
          postBundlerDeposit: async () => {
            setBalance("1000");
            return { statusClass: "accepted", httpStatus };
          },
        },
      });
      assert.equal(closed.ok, true, `http ${httpStatus}`);
      assert.equal(readIrysDepositRecord(store, key, "evm").kind, "absent");
    }
  });

  it("balance ≥ price closes open record without send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "1000",
      bundler: EVM_BUNDLER,
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
            return HASH_B;
          },
        },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(sent, false);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "absent");
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
          getItem: (): IrysDepositStoreGetResult => ({ kind: "absent" }),
          setItem: () => {
            throw new Error("quota");
          },
          removeItem: () => undefined,
        },
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return HASH_A;
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
            return HASH_A;
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_contract_wallet");
    assert.equal(sent, false);
  });

  it("disconnected refuses before any store access", async () => {
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    let storeTouched = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: { status: "disconnected" },
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: {
          getItem: (): IrysDepositStoreGetResult => {
            storeTouched = true;
            return { kind: "absent" };
          },
          setItem: () => {
            storeTouched = true;
          },
          removeItem: () => {
            storeTouched = true;
          },
        },
        sendEvmTransaction: {
          sendTransaction: async () => HASH_A,
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.cause, "deposit_write_unavailable");
      assert.equal(r.guard?.guard, "write_availability");
      if (r.guard?.guard === "write_availability") {
        assert.equal(r.guard.refusal.cause, "disconnected");
      }
    }
    assert.equal(storeTouched, false);
  });

  it("EVM wallet on other commercial chain switches before send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let switchedTo: number | null = null;
    let sendChainId: number | null = null;
    const accountOnEth = evmAccount(11155111);
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: accountOnEth,
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        switchChain: async (chainId) => {
          switchedTo = chainId;
        },
        sendEvmTransaction: {
          sendTransaction: async ({ chainId }) => {
            sendChainId = chainId;
            if (switchedTo !== 84532) {
              throw new Error("plant: send without switch");
            }
            return HASH_A;
          },
        },
        waitEvmConfirmations: async ({ txHash }) => ({
          kind: "confirmed",
          hash: txHash,
        }),
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.equal(switchedTo, 84532);
    assert.equal(sendChainId, 84532);
    assert.notEqual(sendChainId, 11155111);
  });

  it("wrong-chain without switchChain port refuses", async () => {
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    let sent = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(11155111),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: createMemoryIrysDepositRecordStore(),
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return HASH_A;
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_send_failed");
    assert.equal(sent, false);
  });

  it("minConfirm from uploader.tokenConfig; missing → deposit_unknown_token", async () => {
    const ok = fakeUploader({ price: "1000", balance: "0", minConfirm: 5 });
    assert.equal(readIrysEvmMinConfirm(ok.uploader), 5);
    const missing = fakeUploader({
      price: "1000",
      balance: "0",
      minConfirm: null,
    });
    assert.equal(readIrysEvmMinConfirm(missing.uploader), null);
    let sent = false;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader: missing.uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: createMemoryIrysDepositRecordStore(),
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sent = true;
            return HASH_A;
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_unknown_token");
    assert.equal(sent, false);
  });

  it("deposit amount is ×1.1 only (via ensureIrysDeposit)", async () => {
    assert.equal(IRYS_DEPOSIT_AMOUNT_NUMERATOR, 11n);
    assert.equal(IRYS_DEPOSIT_AMOUNT_DENOMINATOR, 10n);
    assert.equal(await observedNeededAmount("1000", "0"), 1100n);
    const client = readFileSync(IRYS_CLIENT, "utf8");
    assert.equal(/FUND_FEE_MULTIPLIER/.test(client), false);
    assert.equal(/\.fund\s*\(/.test(client), false);
  });
});

describe("irys deposit B2 — three-state reader + EVM replacement", () => {
  it("stored {not-json → sends === 0, deposit_record_unreadable", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    rawSet(store, key, "{not-json");
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let sends = 0;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_A;
          },
        },
        waitEvmConfirmations: async () => ({
          kind: "confirmed",
          hash: HASH_A,
        }),
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_record_unreadable");
    assert.equal(sends, 0);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "unreadable");
  });

  it("getItem throwing → sends === 0, unreadable", async () => {
    const { uploader } = fakeUploader({ price: "1000", balance: "0" });
    let sends = 0;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store: {
          getItem: () => {
            throw new Error("storage_read_failed");
          },
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_A;
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_record_unreadable");
    assert.equal(sends, 0);
  });

  it("invalid EVM hash → unreadable; no confirm; no send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    rawSet(
      store,
      key,
      JSON.stringify({
        vm: "evm",
        txHash: "not-a-hash",
        amountBaseUnits: "100",
        createdAt: Date.now(),
      }),
    );
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let sends = 0;
    let confirms = 0;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_A;
          },
        },
        waitEvmConfirmations: async () => {
          confirms += 1;
          return { kind: "confirmed", hash: HASH_A };
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_record_unreadable");
    assert.equal(sends, 0);
    assert.equal(confirms, 0);
  });

  it("invalid SVM signature → unreadable; no confirm; no send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: FIXTURE_SVM_NAMESPACE,
      payer: SVM_PAYER,
      bundlerAddress: SVM_BUNDLER,
    });
    rawSet(
      store,
      key,
      JSON.stringify({
        vm: "svm",
        signature: "notAValidEd25519Signature",
        lastValidBlockHeight: "10",
        amountBaseUnits: "100",
        createdAt: Date.now(),
      }),
    );
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: SVM_BUNDLER,
    });
    let sends = 0;
    let confirms = 0;
    const r = await ensureIrysDeposit({
      stack: FIXTURE_SVM_STACK,
      account: svmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "solana",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        svmSignAndSend: {
          signAndSendTransaction: async () => {
            sends += 1;
            return new Uint8Array(64);
          },
        },
        confirmSvmFunding: {
          confirmSubmission: async () => {
            confirms += 1;
            return {
              kind: "landed_ok",
              signature: SVM_SIG,
              slot: 1n,
            };
          },
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_record_unreadable");
    assert.equal(sends, 0);
    assert.equal(confirms, 0);
  });

  it("replaced to bundler → record holds new hash; post uses it", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let waitedExpectedTo: string | null = null;
    let postedId: string | null = null;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async ({ txHash, expectedTo }) => {
          assert.equal(txHash, HASH_A);
          waitedExpectedTo = expectedTo;
          return { kind: "confirmed", hash: HASH_B };
        },
        postBundlerDeposit: async ({ txId }) => {
          postedId = txId;
          return { statusClass: "not_seen_yet", httpStatus: 400 };
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.equal(
      String(waitedExpectedTo ?? "").toLowerCase(),
      EVM_BUNDLER.toLowerCase(),
    );
    assert.equal(postedId, HASH_B);
    const after = readIrysDepositRecord(store, key, "evm");
    assert.equal(after.kind, "record");
    if (after.kind === "record" && after.record.vm === "evm") {
      assert.equal(after.record.txHash, HASH_B);
    }
  });

  it("replaced to non-bundler → diverted; cleared; post never; next sends once", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let posted = 0;
    const r1 = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async () => ({
          kind: "diverted",
          originalHash: HASH_A,
          replacementHash: HASH_C,
        }),
        postBundlerDeposit: async () => {
          posted += 1;
          return { statusClass: "accepted", httpStatus: 200 };
        },
      },
    });
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.cause, "deposit_cancelled");
    assert.equal(posted, 0);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "absent");
    assert.match(
      irysDepositCauseCopy("deposit_cancelled"),
      /cancelled or replaced in the wallet/i,
    );

    let sends = 0;
    const r2 = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_B;
          },
        },
        waitEvmConfirmations: async ({ txHash }) => ({
          kind: "confirmed",
          hash: txHash,
        }),
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.cause, "deposit_pending");
    assert.equal(sends, 1);
  });

  it("repriced → followed (final hash in record + post)", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let postedId: string | null = null;
    await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async () => ({
          kind: "confirmed",
          hash: HASH_C,
        }),
        postBundlerDeposit: async ({ txId }) => {
          postedId = txId;
          return { statusClass: "not_seen_yet", httpStatus: 400 };
        },
      },
    });
    assert.equal(postedId, HASH_C);
    const after = readIrysDepositRecord(store, key, "evm");
    assert.equal(after.kind, "record");
    if (after.kind === "record" && after.record.vm === "evm") {
      assert.equal(after.record.txHash, HASH_C);
    }
  });

  it("cancelled (receipt present, reason cancelled) → cleared; deposit_cancelled; next sends once", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let posted = 0;
    const r1 = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async () => ({
          kind: "cancelled",
          originalHash: HASH_A,
        }),
        postBundlerDeposit: async () => {
          posted += 1;
          return { statusClass: "accepted", httpStatus: 200 };
        },
      },
    });
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.equal(r1.cause, "deposit_cancelled");
    assert.equal(posted, 0);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "absent");
    assert.match(
      irysDepositCauseCopy("deposit_cancelled"),
      /cancelled or replaced in the wallet/i,
    );

    let sends = 0;
    const r2 = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_B;
          },
        },
        waitEvmConfirmations: async ({ txHash }) => ({
          kind: "confirmed",
          hash: txHash,
        }),
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.cause, "deposit_pending");
    assert.equal(sends, 1);
  });

  it("timeout → record kept; deposit_pending", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const key = irysDepositRecordKey({
      namespace: 84532,
      payer: EVM_PAYER,
      bundlerAddress: EVM_BUNDLER,
    });
    writeIrysDepositRecord(store, key, {
      vm: "evm",
      txHash: HASH_A,
      amountBaseUnits: "100",
      createdAt: Date.now(),
    });
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let posted = 0;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        waitEvmConfirmations: async () => ({ kind: "timeout" }),
        postBundlerDeposit: async () => {
          posted += 1;
          return { statusClass: "accepted", httpStatus: 200 };
        },
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.equal(posted, 0);
    assert.equal(readIrysDepositRecord(store, key, "evm").kind, "record");
  });

  it("absent → exactly one send", async () => {
    const store = createMemoryIrysDepositRecordStore();
    const { uploader } = fakeUploader({
      price: "1000",
      balance: "0",
      bundler: EVM_BUNDLER,
    });
    let sends = 0;
    const r = await ensureIrysDeposit({
      stack: EVM_STACK,
      account: evmAccount(),
      uploader,
      totalBytes: 100,
      paymentToken: "base-eth",
      bundlerUrl: "https://devnet.irys.xyz",
      ports: {
        store,
        readEvmAccountKind: async () => "eoa",
        sendEvmTransaction: {
          sendTransaction: async () => {
            sends += 1;
            return HASH_A;
          },
        },
        waitEvmConfirmations: async ({ txHash }) => ({
          kind: "confirmed",
          hash: txHash,
        }),
        postBundlerDeposit: async () => ({
          statusClass: "not_seen_yet",
          httpStatus: 400,
        }),
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "deposit_pending");
    assert.equal(sends, 1);
  });

  it("runTx pin: confirmEvmTransaction returns EvmConfirmOutcome; confirmations return deposit outcome", () => {
    const confirm = readFileSync(EVM_TX_CONFIRM, "utf8");
    assert.match(
      confirm,
      /export async function confirmEvmTransaction\([\s\S]*?\): Promise<EvmConfirmOutcome>/,
    );
    assert.match(confirm, /EvmDepositConfirmOutcome/);
    assert.match(confirm, /kind: "confirmed"/);
    assert.match(confirm, /kind: "cancelled"/);
    assert.match(confirm, /kind: "diverted"/);
    assert.match(confirm, /kind: "timeout"/);
    assert.match(confirm, /onReplaced/);
    assert.match(confirm, /reason === "cancelled"/);
    assert.match(confirm, /reason === "repriced"/);
    assert.match(confirm, /confirmations:\s*minConfirmations/);
    assert.match(confirm, /isAddressEqual/);
    assert.match(confirm, /EVM_TX_CONFIRM_TIMEOUT_MS/);
    assert.match(confirm, /WaitForTransactionReceiptTimeoutError/);
    assert.equal(/getPublicClient/.test(confirm), false);
    assert.equal(/getTransactionConfirmations/.test(confirm), false);
    assert.equal(/from "wagmi\/actions"/.test(confirm), false);

    const dirtyPoll =
      'await client.getTransactionConfirmations({ hash });\ngetPublicClient(chainId);\n';
    assert.match(dirtyPoll, /getTransactionConfirmations/);
    assert.match(dirtyPoll, /getPublicClient/);

    const lifecycle = readFileSync(EVM_WRITE_LIFECYCLE, "utf8");
    assert.match(lifecycle, /confirmEvmTransaction/);
    assert.match(lifecycle, /EvmConfirmRefusal/);
    assert.equal(/confirmEvmTransactionConfirmations/.test(lifecycle), false);

    const deposit = readFileSync(IRYS_DEPOSIT, "utf8");
    assert.match(deposit, /EvmDepositConfirmOutcome/);
    assert.match(deposit, /deposit_cancelled/);
    assert.match(deposit, /expectedTo/);
    assert.equal(/record\.txId as `0x\$\{string\}`/.test(deposit), false);
    assert.equal(/txId as `0x\$\{string\}`/.test(deposit), false);
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
    assert.deepEqual(Buffer.from(encoded.data), Buffer.from(web3.data));
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
        value: {
          blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUqlTPUYFJm",
          lastValidBlockHeight: 1n,
        },
      }),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.cause, "unregistered_program");
  });

  it("no EIP-1193 deposit path; confirmations live in evm-tx-confirm", () => {
    const deposit = readFileSync(IRYS_DEPOSIT, "utf8");
    assert.equal(/eth_sendTransaction/.test(deposit), false);
    assert.equal(/eth_accounts/.test(deposit), false);
    assert.equal(/waitForTransactionReceipt/.test(deposit), false);
    assert.equal(/getPublicClient/.test(deposit), false);
    assert.equal(/createIrysEvmDepositSendPortFromProvider/.test(deposit), false);
    assert.equal(/waitIrysEvmDepositConfirmations/.test(deposit), false);
    assert.equal(/IRYS_EVM_DEPOSIT_MIN_CONFIRMATIONS/.test(deposit), false);
    assert.equal(/irysDepositNeededAmountForTests/.test(deposit), false);
    assert.match(deposit, /tokenConfig/);
    assert.match(deposit, /readIrysEvmMinConfirm/);
    assert.match(deposit, /deposit_record_unreadable/);
    assert.match(deposit, /deposit_expired/);
    assert.match(deposit, /deposit_cancelled/);

    const record = readFileSync(IRYS_DEPOSIT_RECORD, "utf8");
    assert.match(record, /kind: "absent"/);
    assert.match(record, /kind: "unreadable"/);
    assert.equal(/catch \{\s*return null/.test(record), false);

    const confirm = readFileSync(EVM_TX_CONFIRM, "utf8");
    assert.match(confirm, /confirmEvmTransactionConfirmations/);
    assert.match(confirm, /waitForTransactionReceipt/);
    assert.match(confirm, /onReplaced/);
    assert.match(confirm, /confirmations:\s*minConfirmations/);
    assert.equal(/getPublicClient/.test(confirm), false);
    assert.equal(/getTransactionConfirmations/.test(confirm), false);

    const hook = readFileSync(DEPOSIT_HOOK, "utf8");
    assert.match(hook, /useEvmSendTransaction/);
    assert.match(hook, /confirmEvmTransactionConfirmations/);
    assert.match(hook, /switchChain/);
  });

  it("product scan: eth_sendTransaction / eth_accounts / waitForTransactionReceipt outside owners", () => {
    const owners = new Set([
      EVM_WRITE_ADAPTER,
      EVM_TX_CONFIRM,
    ]);
    const banned =
      /\beth_sendTransaction\b|\beth_accounts\b|\bwaitForTransactionReceipt\b/;
    const scan = scanProductSources((text, relativePath) => {
      if (owners.has(relativePath)) return false;
      if (!banned.test(text)) return false;
      if (
        relativePath === IRYS_DEPOSIT ||
        relativePath.includes("irys-deposit")
      ) {
        return "irys_deposit_eip1193_or_receipt";
      }
      return false;
    });
    assertCleanProductScan(scan);

    const dirtyPlant =
      'await provider.request({ method: "eth_sendTransaction", params: [] });\n';
    assert.match(dirtyPlant, banned);
  });

  it("no raw err.message in upload copy; wallet rejection named; guard copy", () => {
    const meta = readFileSync(UPLOAD_META, "utf8");
    assert.equal(/err\.message\.includes/.test(meta), false);
    assert.equal(/return err\.message/.test(meta), false);
    assert.match(meta, /formatIrysUploadError/);
    assert.equal(
      formatIrysUploadError(new IrysDepositRefusal("deposit_pending")),
      irysDepositCauseCopy("deposit_pending"),
    );
    const guardCopy = formatIrysUploadError(
      new IrysDepositRefusal("deposit_write_unavailable", {
        guard: {
          guard: "write_availability",
          refusal: { available: false, cause: "disconnected" },
        },
      }),
    );
    assert.notEqual(guardCopy, irysDepositCauseCopy("deposit_write_unavailable"));
    assert.match(guardCopy, /connect/i);
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
        getItem: (): IrysDepositStoreGetResult => ({ kind: "absent" }),
        setItem: () => {
          throw new Error("no");
        },
        removeItem: () => undefined,
      }),
      false,
    );
  });

  it("Eth Sepolia stack exists for wrong-chain plant", () => {
    assert.equal(Number(ETH_STACK.namespace), 11155111);
  });
});
