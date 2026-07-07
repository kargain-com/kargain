"use client";

const DB_NAME = "kargain_nostr";
const STORE_NAME = "secure";

function requireBrowser(): void {
  if (typeof window === "undefined" || !window.indexedDB) {
    throw new Error("Secure blob store requires browser IndexedDB.");
  }
}

function openDb(): Promise<IDBDatabase> {
  requireBrowser();
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
  });
}

async function idbGet<T>(recordKey: string): Promise<T | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(recordKey);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed."));
  });
}

async function idbSet<T>(recordKey: string, value: T): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, recordKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed."));
  });
}

async function idbRemove(recordKey: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(recordKey);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB delete failed."));
  });
}

function lsFallbackKey(recordKey: string, legacyLocalStorageKey?: string): string {
  return legacyLocalStorageKey ?? `kargain_secure_blob_fallback:${recordKey}`;
}

function localStorageGet<T>(recordKey: string, legacyLocalStorageKey?: string): T | null {
  requireBrowser();
  const raw = window.localStorage.getItem(lsFallbackKey(recordKey, legacyLocalStorageKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function localStorageSet<T>(
  recordKey: string,
  value: T,
  legacyLocalStorageKey?: string,
): void {
  requireBrowser();
  window.localStorage.setItem(
    lsFallbackKey(recordKey, legacyLocalStorageKey),
    JSON.stringify(value),
  );
}

function localStorageRemove(recordKey: string, legacyLocalStorageKey?: string): void {
  requireBrowser();
  window.localStorage.removeItem(lsFallbackKey(recordKey, legacyLocalStorageKey));
}

async function canUseIndexedDb(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

export type SecureBlobOptions = {
  /** Preserves legacy localStorage key names when migrating from inline storage. */
  legacyLocalStorageKey?: string;
};

export async function getBlob<T>(
  recordKey: string,
  options?: SecureBlobOptions,
): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const legacy = options?.legacyLocalStorageKey;
  if (await canUseIndexedDb()) {
    try {
      return await idbGet<T>(recordKey);
    } catch {
      return localStorageGet<T>(recordKey, legacy);
    }
  }
  return localStorageGet<T>(recordKey, legacy);
}

export async function setBlob<T>(
  recordKey: string,
  value: T,
  options?: SecureBlobOptions,
): Promise<void> {
  requireBrowser();
  const legacy = options?.legacyLocalStorageKey;
  if (await canUseIndexedDb()) {
    try {
      await idbSet(recordKey, value);
      return;
    } catch {
      localStorageSet(recordKey, value, legacy);
      return;
    }
  }
  localStorageSet(recordKey, value, legacy);
}

export async function removeBlob(
  recordKey: string,
  options?: SecureBlobOptions,
): Promise<void> {
  if (typeof window === "undefined") return;
  const legacy = options?.legacyLocalStorageKey;
  if (await canUseIndexedDb()) {
    try {
      await idbRemove(recordKey);
    } catch {
      localStorageRemove(recordKey, legacy);
    }
  } else {
    localStorageRemove(recordKey, legacy);
  }
  localStorageRemove(recordKey, legacy);
}
