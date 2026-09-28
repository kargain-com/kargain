/**
 * Pending Irys deposit record — one storage owner.
 *
 * Key: commercial namespace + payer + bundler address.
 * Production store = localStorage (every access try/catch). Injectable for tests.
 */

export type IrysDepositRecord = {
  txId: string;
  amountBaseUnits: string;
  createdAt: number;
  /** Required for SVM — blockhash lifetime of the funding transfer. */
  lastValidBlockHeight?: string;
};

export type IrysDepositRecordStore = {
  getItem: (key: string) => string | null;
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
    getItem: (key) => map.get(key) ?? null,
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
      try {
        if (typeof localStorage === "undefined") return null;
        return localStorage.getItem(key);
      } catch {
        return null;
      }
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
    return read === token;
  } catch {
    try {
      store.removeItem(PROBE_KEY);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function readIrysDepositRecord(
  store: IrysDepositRecordStore,
  key: string,
): IrysDepositRecord | null {
  try {
    const raw = store.getItem(key);
    if (raw == null || raw.length === 0) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    const rec = parsed as Record<string, unknown>;
    if (
      typeof rec.txId !== "string" ||
      rec.txId.length === 0 ||
      typeof rec.amountBaseUnits !== "string" ||
      typeof rec.createdAt !== "number"
    ) {
      return null;
    }
    const out: IrysDepositRecord = {
      txId: rec.txId,
      amountBaseUnits: rec.amountBaseUnits,
      createdAt: rec.createdAt,
    };
    if (typeof rec.lastValidBlockHeight === "string") {
      out.lastValidBlockHeight = rec.lastValidBlockHeight;
    }
    return out;
  } catch {
    return null;
  }
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
