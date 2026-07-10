"use client";

import { type Address, hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import { getOrCreateNostrKey } from "@/lib/nostr/key-manager";
import { isProfilePublishBlockedByRotation } from "@/lib/nostr/identity-rotation";
import {
  fetchLatestKind0RawByAuthor,
  isMergeBaseUnavailable,
  mergeKind0Content,
} from "@/lib/nostr/merge-kind0-content";
import { parseProfileContent, type NostrProfileData } from "@/lib/nostr/parse-profile-content";
import {
  attestationMessage,
  buildProfileAttestation,
  verifyProfileAttestationCore,
  type ProfileAttestationV1,
} from "@/lib/nostr/profile-attestation";
import {
  getNostrPool,
  nostrPubkeyFromPrivateKey,
} from "@/lib/nostr/nostr-client";
import { publishSignedEvent } from "@/lib/nostr/publish-event";
import { resolveAttestedProfile } from "@/lib/nostr/resolve-attested-profile";

export type { NostrProfileData, ProfileAttestationV1 } from "@/lib/nostr/parse-profile-content";

export type PublishNostrProfileOpts = { expectExisting?: boolean };

function toWalletAddress(address: Address): `0x${string}` {
  return address as `0x${string}`;
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

/** Canonical public profile read — attestation-verified via central resolver. */
export async function fetchNostrProfileByEthereumTag(
  walletAddress: Address,
  maxWait = 3000,
): Promise<NostrProfileData | null> {
  return resolveAttestedProfile(walletAddress, {
    pool: getNostrPool(),
    maxWait,
  });
}

/** Fetch kind:0 profile for a wallet address from relays. Never throws. */
export async function fetchNostrProfile(
  walletAddress: Address,
): Promise<NostrProfileData | null> {
  try {
    return await fetchNostrProfileByEthereumTag(walletAddress, 3000);
  } catch {
    return null;
  }
}

/** Sign and publish a kind:0 profile event with NIP-39 identity tag. Never throws. */
export async function publishNostrProfileWithPrivateKey(
  data: NostrProfileData,
  walletAddress: Address,
  privateKeyHex: string,
  attestation?: ProfileAttestationV1,
  opts?: PublishNostrProfileOpts,
): Promise<boolean> {
  try {
    const address = toWalletAddress(walletAddress);
    const pubkey = nostrPubkeyFromPrivateKey(privateKeyHex);
    const existing = await fetchLatestKind0RawByAuthor(pubkey, { pool: getNostrPool() });
    if (isMergeBaseUnavailable(existing, opts?.expectExisting === true)) {
      return false;
    }
    const content = mergeKind0Content(existing, data);
    if (attestation) {
      content.attestation = attestation;
    }
    const unsigned = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify(content),
      tags: [["i", `ethereum:${address.toLowerCase()}`]] as string[][],
    };
    const signed = finalizeEvent(unsigned, toPrivateKeyBytes(privateKeyHex));
    const pool = getNostrPool();
    const { ok } = await publishSignedEvent(pool, signed);
    return ok;
  } catch {
    return false;
  }
}

/** Publish kind:0 profile using wallet-derived Nostr key. Never throws. */
export async function publishNostrProfile(
  data: NostrProfileData,
  walletAddress: Address,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts?: PublishNostrProfileOpts,
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
    const pubkey = nostrPubkeyFromPrivateKey(privateKey);
    if (await isProfilePublishBlockedByRotation(address, pubkey)) {
      return false;
    }
    const existing = await fetchLatestKind0RawByAuthor(pubkey, { pool: getNostrPool() });
    if (isMergeBaseUnavailable(existing, opts?.expectExisting === true)) {
      return false;
    }
    const hasValidAttestation = await verifyProfileAttestationCore(
      { id: `write:${pubkey}`, pubkey, content: JSON.stringify(existing) },
      address,
    );

    if (hasValidAttestation) {
      return publishNostrProfileWithPrivateKey(data, walletAddress, privateKey, undefined, opts);
    }

    const attestationSig = (await signer.signMessage(
      attestationMessage(pubkey, address),
    )) as `0x${string}`;
    const attestation = buildProfileAttestation({
      pubkey,
      address,
      signature: attestationSig,
    });
    return publishNostrProfileWithPrivateKey(
      data,
      walletAddress,
      privateKey,
      attestation,
      opts,
    );
  } catch {
    return false;
  }
}
