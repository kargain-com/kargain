"use client";

import { type Address, hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { getOrCreateNostrKey, loadDecryptedKey } from "@/lib/nostr/key-manager";
import {
  getNostrPool,
  NOSTR_RELAYS,
  nostrPubkeyFromPrivateKey,
  resolveNostrPubkeyForEthereumAddress,
} from "@/lib/nostr/nostr-client";

export type NostrProfileData = {
  name?: string;
  about?: string;
  picture?: string;
  website?: string;
};

function toWalletAddress(address: Address): `0x${string}` {
  return address as `0x${string}`;
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

function parseProfileContent(content: string): NostrProfileData | null {
  if (!content.trim()) return {};
  try {
    const raw: unknown = JSON.parse(content);
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    const result: NostrProfileData = {};
    if (typeof obj.name === "string") result.name = obj.name;
    if (typeof obj.about === "string") result.about = obj.about;
    if (typeof obj.picture === "string") result.picture = obj.picture;
    if (typeof obj.website === "string") result.website = obj.website;
    return result;
  } catch {
    return {};
  }
}

async function resolvePubkeyForAddress(walletAddress: Address): Promise<string | null> {
  const address = toWalletAddress(walletAddress);
  const storedKey = await loadDecryptedKey({
    address,
    signMessage: async () => "" as `0x${string}`,
  });
  if (storedKey) {
    return nostrPubkeyFromPrivateKey(storedKey);
  }
  return resolveNostrPubkeyForEthereumAddress(address);
}

/** Fetch kind:0 profile for a wallet address from relays. Never throws. */
export async function fetchNostrProfile(
  walletAddress: Address,
): Promise<NostrProfileData | null> {
  try {
    const pubkey = await resolvePubkeyForAddress(walletAddress);
    if (!pubkey) return null;

    const pool = getNostrPool();
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], authors: [pubkey], limit: 1 },
      { maxWait: 5000 },
    );
    if (events.length === 0) return null;

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) return null;

    return parseProfileContent(latest.content);
  } catch {
    return null;
  }
}

/** Sign and publish a kind:0 profile event with NIP-39 identity tag. Never throws. */
export async function publishNostrProfileWithPrivateKey(
  data: NostrProfileData,
  walletAddress: Address,
  privateKeyHex: string,
): Promise<boolean> {
  try {
    const address = toWalletAddress(walletAddress);
    const unsigned = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(data),
      tags: [["i", `ethereum:${address.toLowerCase()}`]] as string[][],
    };
    const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKeyHex));
    const pool = getNostrPool();
    await Promise.any(pool.publish([...NOSTR_RELAYS], signed));
    return true;
  } catch {
    return false;
  }
}

/** Publish kind:0 profile using wallet-derived Nostr key. Never throws. */
export async function publishNostrProfile(
  data: NostrProfileData,
  walletAddress: Address,
  signer: { signMessage: (msg: string) => Promise<string> },
): Promise<boolean> {
  try {
    const address = toWalletAddress(walletAddress);
    const privateKey = await getOrCreateNostrKey({
      address,
      signMessage: async (message) => {
        const sig = await signer.signMessage(message);
        return sig as `0x${string}`;
      },
    });
    return publishNostrProfileWithPrivateKey(data, walletAddress, privateKey);
  } catch {
    return false;
  }
}
