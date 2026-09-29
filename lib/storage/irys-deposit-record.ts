/**
 * Pending Irys deposit record — one storage owner.
 *
 * Key: commercial namespace + payer + bundler address.
 * Production store = localStorage. Injectable for tests.
 *
 * Reader answers three states: absent | record | unreadable.
 * Storage read failure is unreadable (never conflated with absent).
 */

import { isHash } from "viem";

import { isWalletStandardSignatureBase58 } from "@/lib/web3/svm-write-adapter";

export type IrysDepositEvmRecord = {
  vm: "evm";
  txHash: `0x${string}`;
  amountBaseUnits: string;
  createdAt: number;
};

export type IrysDepositSvmRecord = {
  vm: "svm";
  signature: string;
  lastValidBlockHeight: string;
  amountBaseUnits: string;
  createdAt: number;
};

export type IrysDepositRecord = IrysDepositEvmRecord | IrysDepositSvmRecord;

export type IrysDepositRecordRead =
  | { kind: "absent" }
  | { kind: "record"; record: IrysDepositRecord }
  | { kind: "unreadable" };

export type IrysDepositStoreGetResult =
  | { kind: "absent" }
  | { kind: "value"; value: string };

export type IrysDepositRecordStore = {
  /** Throws on storage failure — never swallows into absent. */
  getItem: (key: string) => IrysDepositStoreGetResult;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const STORAGE_PREFIX = "kargain:irys-deposit:";
const PROBE_KEY = `${STORAGE_PREFIX}__probe__`;

export function irysDepositRecordKey(args: {
  namespace: number;
  payer: string;
  bundlerAddress: string;
}): string {
  return `${STORAGE_PREFIX}${args.namespace}|${args.payer}|${args.bundlerAddress}`;
}

export function createMemoryIrysDepositRecordStore(): IrysDepositRecordStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => {
      const value = map.get(key);
      if (value == null || value.length === 0) return { kind: "absent" };
      return { kind: "value", value };
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function createLocalStorageIrysDepositRecordStore(): IrysDepositRecordStore {
  return {
    getItem: (key) => {
      if (typeof localStorage === "undefined") {
        throw new Error("deposit_record_storage_unavailable");
      }
      const value = localStorage.getItem(key);
      if (value == null || value.length === 0) return { kind: "absent" };
      return { kind: "value", value };
    },
    setItem: (key, value) => {
      if (typeof localStorage === "undefined") {
        throw new Error("deposit_record_unavailable");
      }
      localStorage.setItem(key, value);
    },
    removeItem: (key) => {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Prove the store can round-trip before any payment.
 * Returns false on any throw or failed read-back.
 */
export function probeIrysDepositRecordStoreWritable(
  store: IrysDepositRecordStore,
): boolean {
  const token = `probe:${Date.now()}`;
  try {
    store.setItem(PROBE_KEY, token);
    const read = store.getItem(PROBE_KEY);
    store.removeItem(PROBE_KEY);
    return read.kind === "value" && read.value === token;
  } catch {
    try {
      store.removeItem(PROBE_KEY);
    } catch {
      /* ignore */
    }
    return false;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isValidSvmSignatureBase58(signature: string): boolean {
  return isWalletStandardSignatureBase58(signature);
}

function parseRecordForVm(
  parsed: unknown,
  vm: "evm" | "svm",
): IrysDepositRecord | null {
  if (parsed == null || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  if (
    !isNonEmptyString(rec.amountBaseUnits) ||
    typeof rec.createdAt !== "number" ||
    !Number.isFinite(rec.createdAt)
  ) {
    return null;
  }
  if (rec.vm !== vm) return null;

  if (vm === "evm") {
    if (!isNonEmptyString(rec.txHash) || !isHash(rec.txHash)) return null;
    return {
      vm: "evm",
      txHash: rec.txHash,
      amountBaseUnits: rec.amountBaseUnits,
      createdAt: rec.createdAt,
    };
  }

  if (
    !isNonEmptyString(rec.signature) ||
    !isValidSvmSignatureBase58(rec.signature) ||
    !isNonEmptyString(rec.lastValidBlockHeight) ||
    !/^\d+$/.test(rec.lastValidBlockHeight)
  ) {
    return null;
  }
  return {
    vm: "svm",
    signature: rec.signature,
    lastValidBlockHeight: rec.lastValidBlockHeight,
    amountBaseUnits: rec.amountBaseUnits,
    createdAt: rec.createdAt,
  };
}

/**
 * Three-state reader. Only `absent` permits a new deposit.
 * Unparseable, invalid, wrong-vm, or storage throw → `unreadable`.
 */
export function readIrysDepositRecord(
  store: IrysDepositRecordStore,
  key: string,
  vm: "evm" | "svm",
): IrysDepositRecordRead {
  let got: IrysDepositStoreGetResult;
  try {
    got = store.getItem(key);
  } catch {
    return { kind: "unreadable" };
  }
  if (got.kind === "absent") return { kind: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(got.value) as unknown;
  } catch {
    return { kind: "unreadable" };
  }
  const record = parseRecordForVm(parsed, vm);
  if (record == null) return { kind: "unreadable" };
  return { kind: "record", record };
}

export function writeIrysDepositRecord(
  store: IrysDepositRecordStore,
  key: string,
  record: IrysDepositRecord,
): boolean {
  try {
    store.setItem(key, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearIrysDepositRecord(
  store: IrysDepositRecordStore,
  key: string,
): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}
