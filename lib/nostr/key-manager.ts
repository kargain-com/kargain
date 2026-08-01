"use client";

import {
  decryptPrivateKeyV2,
  deriveNostrSkFromSignature,
  encryptPrivateKeyV2,
  isIdentityBlob,
  nostrLinkMessage,
  skMatchesSignature,
  type StoredEncryptedV2,
} from "@/lib/nostr/key-manager-crypto";
import { getBlob, removeBlob, setBlob } from "@/lib/nostr/secure-blob-store";
import {
  supportsPersonalSignIdentity,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

const BLOB_KEY = "kargain_nostr_key_encrypted";

export type WalletSigner = {
  address: `0x${string}`;
  signMessage: (message: string) => Promise<`0x${string}`>;
  /** When set, contract accounts are refused before any signature prompt. */
  accountKind?: WalletAccountKind;
};

function requireBrowser() {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Nostr key manager requires browser Web Crypto.");
  }
}

function assertPersonalSignAccount(wallet: WalletSigner): void {
  if (wallet.accountKind != null && !supportsPersonalSignIdentity(wallet.accountKind)) {
    throw new Error("Contract wallets cannot derive a Nostr identity.");
  }
}

async function signCanonicalMessage(wallet: WalletSigner): Promise<`0x${string}`> {
  return wallet.signMessage(nostrLinkMessage(wallet.address));
}

async function persistBlob(
  wallet: WalletSigner,
  signature: `0x${string}`,
  privateKeyHex: `0x${string}`,
): Promise<void> {
  const encrypted = await encryptPrivateKeyV2(signature, wallet.address, privateKeyHex);
  await setBlob(BLOB_KEY, encrypted);
}

/**
 * Unlock a stored identity blob. Fail closed: never overwrite with a freshly
 * derived key when decrypt fails or the plaintext does not match the signature.
 */
async function restoreFromBlob(
  existing: StoredEncryptedV2,
  signature: `0x${string}`,
): Promise<`0x${string}`> {
  let decrypted: `0x${string}`;
  try {
    decrypted = await decryptPrivateKeyV2(signature, existing);
  } catch {
    throw new Error(
      "Stored Nostr key could not be unlocked with this wallet signature.",
    );
  }
  if (!skMatchesSignature(decrypted, signature)) {
    throw new Error("Stored Nostr key does not match this wallet signature.");
  }
  return decrypted;
}

let pendingKeyPromise: Promise<`0x${string}`> | null = null;
let pendingWalletAddress: string | null = null;

async function createOrRestoreNostrKey(wallet: WalletSigner): Promise<`0x${string}`> {
  assertPersonalSignAccount(wallet);

  const existingRaw = await getBlob<unknown>(BLOB_KEY);
  const existing =
    isIdentityBlob(existingRaw) &&
    existingRaw.address.toLowerCase() === wallet.address.toLowerCase()
      ? existingRaw
      : null;

  const signature = await signCanonicalMessage(wallet);

  if (existing) {
    return restoreFromBlob(existing, signature);
  }

  const privateKeyHex = deriveNostrSkFromSignature(signature);
  await persistBlob(wallet, signature, privateKeyHex);
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

/** Explicit destructive clear — never called automatically on signature drift. */
export async function clearStoredNostrKey(): Promise<void> {
  if (typeof window === "undefined") return;
  await removeBlob(BLOB_KEY);
}
