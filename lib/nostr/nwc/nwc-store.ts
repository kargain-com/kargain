"use client";

import {
  decryptSecretPayloadV2,
  encryptSecretPayloadV2,
  type StoredEncryptedV2,
} from "@/lib/nostr/key-manager-crypto";
import { parseNwcUri, type ParsedNwcConnection } from "@/lib/nostr/nwc/nwc-uri";
import { getBlob, removeBlob, setBlob } from "@/lib/nostr/secure-blob-store";

const RECORD_PREFIX = "kargain_nwc_connection_v1:";
const PRESENCE_PREFIX = "kargain_nwc_present_v1:";

function recordKey(address: `0x${string}`): string {
  return `${RECORD_PREFIX}${address.toLowerCase()}`;
}

function presenceKey(address: `0x${string}`): string {
  return `${PRESENCE_PREFIX}${address.toLowerCase()}`;
}

function requireBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("NWC storage requires a browser.");
  }
}

export async function saveNwcConnection(
  address: `0x${string}`,
  signature: `0x${string}`,
  uri: string,
): Promise<void> {
  requireBrowser();
  const blob = await encryptSecretPayloadV2(signature, address, uri);
  await setBlob(recordKey(address), blob);
  window.localStorage.setItem(presenceKey(address), "1");
}

export async function loadNwcConnection(
  address: `0x${string}`,
  signature: `0x${string}`,
): Promise<ParsedNwcConnection | null> {
  requireBrowser();
  const blob = await getBlob<StoredEncryptedV2>(recordKey(address));
  if (!blob || blob.address.toLowerCase() !== address.toLowerCase()) return null;
  try {
    const uri = await decryptSecretPayloadV2(signature, blob);
    return parseNwcUri(uri);
  } catch {
    return null;
  }
}

export function hasNwcConnection(address: `0x${string}`): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(presenceKey(address)) === "1";
}

export async function clearNwcConnection(address: `0x${string}`): Promise<void> {
  requireBrowser();
  await removeBlob(recordKey(address));
  window.localStorage.removeItem(presenceKey(address));
}
