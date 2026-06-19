"use client";

import { bytesToHex, hexToBytes, keccak256, toHex } from "viem";

const DB_NAME = "kargain_nostr";
const STORE_NAME = "secure";
const BLOB_KEY = "kargain_nostr_key_encrypted";
const LS_FALLBACK_KEY = "kargain_nostr_key_encrypted_fallback";
const NOSTR_SALT = "kargain-nostr-v1-salt";
const AES_SALT = "kargain-nostr-aes-v1-salt";

type WalletSigner = {
  address: `0x${string}`;
  signMessage: (message: string) => Promise<`0x${string}`>;
};

type StoredEncrypted = {
  address: `0x${string}`;
  ivHex: string;
  cipherHex: string;
  createdAt: number;
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

function nostrLinkMessage(address: `0x${string}`): string {
  return `kargain-nostr-v1:${address.toLowerCase()}`;
}

function aesLinkMessage(address: `0x${string}`): string {
  return `kargain-aes-v1:${address.toLowerCase()}`;
}

function normalizeHex32(v: string): `0x${string}` {
  const x = v.startsWith("0x") ? v : `0x${v}`;
  if (hexToBytes(x as `0x${string}`).length !== 32) {
    throw new Error("Expected 32-byte key.");
  }
  return x as `0x${string}`;
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

async function deriveAesKey(address: `0x${string}`): Promise<CryptoKey> {
  const seed = keccak256(toHex(`${aesLinkMessage(address)}${AES_SALT}`));
  const raw = new Uint8Array(hexToBytes(seed));
  return await window.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function deriveNostrSkFromSignature(signature: `0x${string}`): `0x${string}` {
  return normalizeHex32(keccak256(toHex(`${signature}${NOSTR_SALT}`)));
}

async function encryptPrivateKey(address: `0x${string}`, privateKeyHex: `0x${string}`): Promise<StoredEncrypted> {
  const key = await deriveAesKey(address);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(hexToBytes(privateKeyHex));
  const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    address,
    ivHex: bytesToHex(iv),
    cipherHex: bytesToHex(new Uint8Array(cipher)),
    createdAt: Date.now(),
  };
}

async function decryptPrivateKey(address: `0x${string}`, blob: StoredEncrypted): Promise<`0x${string}`> {
  const key = await deriveAesKey(address);
  const plain = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(hexToBytes(blob.ivHex as `0x${string}`)) },
    key,
    new Uint8Array(hexToBytes(blob.cipherHex as `0x${string}`)),
  );
  return normalizeHex32(bytesToHex(new Uint8Array(plain)));
}

let pendingKeyPromise: Promise<`0x${string}`> | null = null;
let pendingWalletAddress: string | null = null;

async function createOrRestoreNostrKey(wallet: WalletSigner): Promise<`0x${string}`> {
  const storage = await getStorageBackend();
  const existing = await storage.get();
  if (existing && existing.address.toLowerCase() === wallet.address.toLowerCase()) {
    try {
      return await decryptPrivateKey(wallet.address, existing);
    } catch {
      // Corrupted local blob: deterministic re-link and overwrite below.
    }
  }

  const msg = nostrLinkMessage(wallet.address);
  const signature = await wallet.signMessage(msg);
  const privateKeyHex = deriveNostrSkFromSignature(signature);
  const encrypted = await encryptPrivateKey(wallet.address, privateKeyHex);
  await storage.set(encrypted);
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
  try {
    return await decryptPrivateKey(wallet.address, existing);
  } catch {
    return null;
  }
}

export async function getNostrStorageBackendName(): Promise<"indexeddb" | "localstorage"> {
  const storage = await getStorageBackend();
  return storage.name;
}

export type { WalletSigner };
