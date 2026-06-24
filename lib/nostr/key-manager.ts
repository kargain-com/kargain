"use client";

import {
  decryptPrivateKeyV1,
  decryptPrivateKeyV2,
  deriveNostrSkFromSignature,
  encryptPrivateKeyV2,
  isV2Blob,
  nostrLinkMessage,
  skMatchesSignature,
  type StoredEncrypted,
  type StoredEncryptedV1,
  type StoredEncryptedV2,
} from "@/lib/nostr/key-manager-crypto";

const DB_NAME = "kargain_nostr";
const STORE_NAME = "secure";
const BLOB_KEY = "kargain_nostr_key_encrypted";
const LS_FALLBACK_KEY = "kargain_nostr_key_encrypted_fallback";

type WalletSigner = {
  address: `0x${string}`;
  signMessage: (message: string) => Promise<`0x${string}`>;
};

type StorageBackend = {
  get: () => Promise<StoredEncrypted | null>;
  set: (blob: StoredEncrypted) => Promise<void>;
  name: "indexeddb" | "localstorage";
};

function requireBrowser() {
  if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.subtle) {
    throw new Error("Nostr key manager requires browser Web Crypto + IndexedDB.");
  }
}

function openDb(): Promise<IDBDatabase> {
  requireBrowser();
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed."));
  });
}

async function idbGet(): Promise<StoredEncrypted | null> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(BLOB_KEY);
    req.onsuccess = () => resolve((req.result as StoredEncrypted | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed."));
  });
}

async function idbSet(blob: StoredEncrypted): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(blob, BLOB_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed."));
  });
}

function localStorageGet(): StoredEncrypted | null {
  requireBrowser();
  const raw = window.localStorage.getItem(LS_FALLBACK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredEncrypted;
  } catch {
    return null;
  }
}

function localStorageSet(blob: StoredEncrypted): void {
  requireBrowser();
  window.localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(blob));
}

async function getStorageBackend(): Promise<StorageBackend> {
  try {
    await openDb();
    return { get: idbGet, set: idbSet, name: "indexeddb" };
  } catch {
    return {
      get: async () => localStorageGet(),
      set: async (blob) => localStorageSet(blob),
      name: "localstorage",
    };
  }
}

async function signCanonicalMessage(wallet: WalletSigner): Promise<`0x${string}`> {
  return wallet.signMessage(nostrLinkMessage(wallet.address));
}

async function persistV2Blob(
  wallet: WalletSigner,
  signature: `0x${string}`,
  privateKeyHex: `0x${string}`,
): Promise<void> {
  const storage = await getStorageBackend();
  const encrypted = await encryptPrivateKeyV2(signature, wallet.address, privateKeyHex);
  await storage.set(encrypted);
}

async function restoreFromV2Blob(
  wallet: WalletSigner,
  existing: StoredEncryptedV2,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  const derived = deriveNostrSkFromSignature(signature);
  let privateKeyHex = derived;
  try {
    const decrypted = await decryptPrivateKeyV2(signature, existing);
    privateKeyHex = skMatchesSignature(decrypted, signature) ? decrypted : derived;
  } catch {
    // Corrupted v2 blob: use deterministic derive.
  }

  await persistV2Blob(wallet, signature, privateKeyHex);
  return privateKeyHex;
}

async function migrateV1Blob(
  wallet: WalletSigner,
  existing: StoredEncryptedV1,
): Promise<`0x${string}`> {
  const privateKeyHex = await decryptPrivateKeyV1(wallet.address, existing);
  const signature = await signCanonicalMessage(wallet);

  if (!skMatchesSignature(privateKeyHex, signature)) {
    const derived = deriveNostrSkFromSignature(signature);
    await persistV2Blob(wallet, signature, derived);
    return derived;
  }

  await persistV2Blob(wallet, signature, privateKeyHex);
  return privateKeyHex;
}

let pendingKeyPromise: Promise<`0x${string}`> | null = null;
let pendingWalletAddress: string | null = null;

async function createOrRestoreNostrKey(wallet: WalletSigner): Promise<`0x${string}`> {
  const storage = await getStorageBackend();
  const existing = await storage.get();

  if (existing && existing.address.toLowerCase() === wallet.address.toLowerCase()) {
    if (isV2Blob(existing)) {
      const signature = await signCanonicalMessage(wallet);
      return restoreFromV2Blob(wallet, existing, signature);
    }

    try {
      return await migrateV1Blob(wallet, existing);
    } catch {
      // Corrupted v1 blob: deterministic re-link below.
    }
  }

  const signature = await signCanonicalMessage(wallet);
  const privateKeyHex = deriveNostrSkFromSignature(signature);
  await persistV2Blob(wallet, signature, privateKeyHex);
  return privateKeyHex;
}

export async function getOrCreateNostrKey(wallet: WalletSigner): Promise<`0x${string}`> {
  requireBrowser();
  const addressKey = wallet.address.toLowerCase();
  if (pendingKeyPromise && pendingWalletAddress === addressKey) {
    return pendingKeyPromise;
  }
  pendingWalletAddress = addressKey;
  pendingKeyPromise = createOrRestoreNostrKey(wallet).finally(() => {
    pendingKeyPromise = null;
    pendingWalletAddress = null;
  });
  return pendingKeyPromise;
}

export async function loadDecryptedKey(wallet: WalletSigner): Promise<`0x${string}` | null> {
  requireBrowser();
  const storage = await getStorageBackend();
  const existing = await storage.get();
  if (!existing) return null;
  if (existing.address.toLowerCase() !== wallet.address.toLowerCase()) return null;
  if (isV2Blob(existing)) return null;

  try {
    return await decryptPrivateKeyV1(wallet.address, existing);
  } catch {
    return null;
  }
}

export type { WalletSigner };
