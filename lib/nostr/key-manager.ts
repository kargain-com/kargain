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
import { getBlob, setBlob } from "@/lib/nostr/secure-blob-store";

const BLOB_KEY = "kargain_nostr_key_encrypted";
const LS_FALLBACK_KEY = "kargain_nostr_key_encrypted_fallback";

const identityBlobOptions = { legacyLocalStorageKey: LS_FALLBACK_KEY };

type WalletSigner = {
  address: `0x${string}`;
  signMessage: (message: string) => Promise<`0x${string}`>;
};

async function storageGet(): Promise<StoredEncrypted | null> {
  return getBlob<StoredEncrypted>(BLOB_KEY, identityBlobOptions);
}

async function storageSet(blob: StoredEncrypted): Promise<void> {
  await setBlob(BLOB_KEY, blob, identityBlobOptions);
}

function requireBrowser() {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Nostr key manager requires browser Web Crypto.");
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
  const encrypted = await encryptPrivateKeyV2(signature, wallet.address, privateKeyHex);
  await storageSet(encrypted);
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
  const existing = await storageGet();

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
  const existing = await storageGet();
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
