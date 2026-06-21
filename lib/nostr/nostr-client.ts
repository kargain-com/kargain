"use client";

import { hexToBytes } from "viem";
import { getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";

/** Default public relays — same set as listing comments. */
export const NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.snort.social",
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

/**
 * Publish kind:0 identity tag via publishNostrProfileWithPrivateKey.
 * Internal-only — no direct external callers; identity publishing moves to /profile/edit (iteration 3).
 * Called only by publishNostrProfile via delegation.
 */
export async function publishEthereumIdentityLink(
  privateKeyHex: string,
  address: `0x${string}`,
): Promise<void> {
  try {
    const { publishNostrProfileWithPrivateKey } = await import("@/lib/nostr/profile");
    await publishNostrProfileWithPrivateKey({}, address, privateKeyHex);
  } catch (err) {
    console.error("publishEthereumIdentityLink failed", err);
  }
}
