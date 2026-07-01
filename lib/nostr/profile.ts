"use client";

import { type Address, hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { getOrCreateNostrKey, loadDecryptedKey } from "@/lib/nostr/key-manager";
import { parseProfileContent, type NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { pickLatestKind0Event } from "@/lib/nostr/pick-latest-kind0";
import {
  getNostrPool,
  NOSTR_RELAYS,
  nostrPubkeyFromPrivateKey,
} from "@/lib/nostr/nostr-client";

export type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

function toWalletAddress(address: Address): `0x${string}` {
  return address as `0x${string}`;
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

function parseProfileContentOrEmpty(content: string): NostrProfileData {
  return parseProfileContent(content) ?? {};
}

async function fetchKind0ByAuthor(pubkey: string, maxWait: number): Promise<NostrProfileData | null> {
  const pool = getNostrPool();
  const events = await pool.querySync(
    [...NOSTR_RELAYS],
    { kinds: [0], authors: [pubkey], limit: 20 },
    { maxWait },
  );
  const latest = pickLatestKind0Event(events);
  if (!latest) return null;
  return parseProfileContentOrEmpty(latest.content);
}

/** Canonical public profile read — same path viewers use (NIP-39 ethereum tag). */
export async function fetchNostrProfileByEthereumTag(
  walletAddress: Address,
  maxWait = 3000,
): Promise<NostrProfileData | null> {
  try {
    const address = toWalletAddress(walletAddress);
    const pool = getNostrPool();
    const tag = `ethereum:${address.toLowerCase()}`;
    const events = await pool.querySync(
      [...NOSTR_RELAYS],
      { kinds: [0], "#i": [tag], limit: 20 },
      { maxWait },
    );
    const latest = pickLatestKind0Event(events);
    if (!latest) return null;
    return parseProfileContentOrEmpty(latest.content);
  } catch {
    return null;
  }
}

/** Fetch kind:0 profile for a wallet address from relays. Never throws. */
export async function fetchNostrProfile(
  walletAddress: Address,
): Promise<NostrProfileData | null> {
  try {
    const address = toWalletAddress(walletAddress);
    const byTag = await fetchNostrProfileByEthereumTag(address, 3000);
    if (byTag) return byTag;

    const storedKey = await loadDecryptedKey({
      address,
      signMessage: async () => "" as `0x${string}`,
    });
    if (!storedKey) return null;

    const pubkey = nostrPubkeyFromPrivateKey(storedKey);
    return fetchKind0ByAuthor(pubkey, 2500);
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
