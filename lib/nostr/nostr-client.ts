"use client";

import { hexToBytes } from "viem";
import { getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

import { NOSTR_RELAYS } from "@/lib/nostr/relays";

export { NOSTR_RELAYS };

let poolInstance: SimplePool | null = null;

export function getNostrPool(): SimplePool {
  if (!poolInstance) {
    poolInstance = new SimplePool();
  }
  return poolInstance;
}

function normalizePrivateKeyHex(privateKeyHex: string): `0x${string}` {
  return (privateKeyHex.startsWith("0x") ? privateKeyHex : `0x${privateKeyHex}`) as `0x${string}`;
}

export function nostrPubkeyFromPrivateKey(privateKeyHex: string): string {
  return getPublicKey(hexToBytes(normalizePrivateKeyHex(privateKeyHex)));
}
