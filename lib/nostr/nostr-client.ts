"use client";

import { hexToBytes } from "viem";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

/** Default public relays — same set as listing comments. */
export const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
] as const;

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

/**
 * Resolve a wallet address to its Nostr pubkey by querying kind:0 identity tags
 * published when the user first saves favorites (`["i", "ethereum:<address>"]`).
 */
export async function resolveNostrPubkeyForEthereumAddress(
  address: `0x${string}`,
): Promise<string | null> {
  try {
    const pool = getNostrPool();
    const tag = `ethereum:${address.toLowerCase()}`;
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], "#i": [tag], limit: 20 },
      { maxWait: 4500 },
    );
    if (events.length === 0) return null;
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    return latest?.pubkey ?? null;
  } catch (err) {
    console.error("resolveNostrPubkeyForEthereumAddress failed", err);
    return null;
  }
}

/** Publish a kind:0 identity link so other users can resolve address → pubkey. */
export async function publishEthereumIdentityLink(
  privateKeyHex: string,
  address: `0x${string}`,
): Promise<void> {
  try {
    const unsigned = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [["i", `ethereum:${address.toLowerCase()}`]],
    };
    const signed = finalizeEvent(unsigned, hexToBytes(normalizePrivateKeyHex(privateKeyHex)));
    const pool = getNostrPool();
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
  } catch (err) {
    console.error("publishEthereumIdentityLink failed", err);
  }
}
