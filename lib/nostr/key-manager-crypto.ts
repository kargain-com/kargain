import { bytesToHex, hexToBytes, keccak256, toHex } from "viem";

export const NOSTR_SALT = "kargain-nostr-v1-salt";
export const AES_V2_SALT = "kargain-nostr-aes-v2-blob-salt";
export const NWC_AES_V2_SALT = "kargain-nwc-v1-salt";

export type StoredEncryptedV2 = {
  version: 2;
  address: `0x${string}`;
  ivHex: string;
  cipherHex: string;
  createdAt: number;
};

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto subtle API is required.");
  }
  return subtle;
}

export function nostrLinkMessage(address: `0x${string}`): string {
  return `kargain-nostr-v1:${address.toLowerCase()}`;
}

export function nwcLinkMessage(address: `0x${string}`): string {
  return `kargain-nwc-v1:${address.toLowerCase()}`;
}

export function normalizeHex32(v: string): `0x${string}` {
  const x = v.startsWith("0x") ? v : `0x${v}`;
  if (hexToBytes(x as `0x${string}`).length !== 32) {
    throw new Error("Expected 32-byte key.");
  }
  return x as `0x${string}`;
}

export function deriveNostrSkFromSignature(signature: `0x${string}`): `0x${string}` {
  return normalizeHex32(keccak256(toHex(`${signature}${NOSTR_SALT}`)));
}

export function skMatchesSignature(
  sk: `0x${string}`,
  signature: `0x${string}`,
): boolean {
  return deriveNostrSkFromSignature(signature) === sk;
}

export function isIdentityBlob(blob: unknown): blob is StoredEncryptedV2 {
  if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return false;
  const o = blob as Record<string, unknown>;
  return (
    o.version === 2 &&
    typeof o.address === "string" &&
    typeof o.ivHex === "string" &&
    typeof o.cipherHex === "string" &&
    typeof o.createdAt === "number"
  );
}

async function importAesKey(seed: Uint8Array): Promise<CryptoKey> {
  const raw = new Uint8Array(seed);
  return requireSubtleCrypto().importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function deriveAesKeyFromSignature(
  signature: `0x${string}`,
  salt: string,
): Promise<CryptoKey> {
  const seed = keccak256(toHex(`${signature}${salt}`));
  return importAesKey(new Uint8Array(hexToBytes(seed)));
}

async function deriveAesKeyV2(signature: `0x${string}`): Promise<CryptoKey> {
  return deriveAesKeyFromSignature(signature, AES_V2_SALT);
}

export async function encryptPrivateKeyV2(
  signature: `0x${string}`,
  address: `0x${string}`,
  privateKeyHex: `0x${string}`,
): Promise<StoredEncryptedV2> {
  const key = await deriveAesKeyV2(signature);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(hexToBytes(privateKeyHex));
  const cipher = await requireSubtleCrypto().encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    version: 2,
    address,
    ivHex: bytesToHex(iv),
    cipherHex: bytesToHex(new Uint8Array(cipher)),
    createdAt: Date.now(),
  };
}

export async function decryptPrivateKeyV2(
  signature: `0x${string}`,
  blob: StoredEncryptedV2,
): Promise<`0x${string}`> {
  const key = await deriveAesKeyV2(signature);
  const plain = await requireSubtleCrypto().decrypt(
    { name: "AES-GCM", iv: new Uint8Array(hexToBytes(blob.ivHex as `0x${string}`)) },
    key,
    new Uint8Array(hexToBytes(blob.cipherHex as `0x${string}`)),
  );
  return normalizeHex32(bytesToHex(new Uint8Array(plain)));
}

/** UTF-8 payload encryption with signature-derived AES (separate salt from identity key). */
export async function encryptSecretPayloadV2(
  signature: `0x${string}`,
  address: `0x${string}`,
  plaintextUtf8: string,
  salt: string = NWC_AES_V2_SALT,
): Promise<StoredEncryptedV2> {
  const key = await deriveAesKeyFromSignature(signature, salt);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(plaintextUtf8);
  const cipher = await requireSubtleCrypto().encrypt({ name: "AES-GCM", iv }, key, plain);
  return {
    version: 2,
    address,
    ivHex: bytesToHex(iv),
    cipherHex: bytesToHex(new Uint8Array(cipher)),
    createdAt: Date.now(),
  };
}

export async function decryptSecretPayloadV2(
  signature: `0x${string}`,
  blob: StoredEncryptedV2,
  salt: string = NWC_AES_V2_SALT,
): Promise<string> {
  const key = await deriveAesKeyFromSignature(signature, salt);
  const plain = await requireSubtleCrypto().decrypt(
    { name: "AES-GCM", iv: new Uint8Array(hexToBytes(blob.ivHex as `0x${string}`)) },
    key,
    new Uint8Array(hexToBytes(blob.cipherHex as `0x${string}`)),
  );
  return new TextDecoder().decode(new Uint8Array(plain));
}
