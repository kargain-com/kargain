"use client";

import { type Address } from "viem";

import { getOrCreateNostrKey } from "@/lib/nostr/key-manager";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import type { ProfileAttestationV1 } from "@/lib/nostr/profile-attestation";
import {
  publishKind0Profile,
} from "@/lib/nostr/publish-kind0-profile";
import { getNostrPool } from "@/lib/nostr/nostr-client";
import { resolveAttestedProfile } from "@/lib/nostr/resolve-attested-profile";

export type { NostrProfileData, ProfileAttestationV1 } from "@/lib/nostr/parse-profile-content";

export type PublishNostrProfileOpts = {
  /**
   * When set, skips `getOrCreateNostrKey` (tests / callers that already hold
   * the key). Still runs attestation unless `attestation` is supplied or the
   * merge base already verifies.
   */
  privateKeyHex?: string;
  /** When set, replaces attestation on the merged content. */
  attestation?: ProfileAttestationV1;
};

/** Canonical public profile read — attestation-verified via central resolver. */
export async function fetchNostrProfileByEthereumTag(
  walletAddress: Address,
): Promise<NostrProfileData | null> {
  return resolveAttestedProfile(walletAddress, {
    pool: getNostrPool(),
  });
}

/** Fetch kind:0 profile for a wallet address from relays. Never throws. */
export async function fetchNostrProfile(
  walletAddress: Address,
): Promise<NostrProfileData | null> {
  try {
    return await fetchNostrProfileByEthereumTag(walletAddress);
  } catch {
    return null;
  }
}

/**
 * Sole kind:0 writer entry for callers that may need unlock: obtains the key
 * when `privateKeyHex` is absent, then publishes via {@link publishKind0Profile}.
 * Messaging passes a held key and uses `publishKind0Profile` directly.
 * Never throws.
 */
export async function publishNostrProfile(
  data: NostrProfileData,
  walletAddress: Address,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts?: PublishNostrProfileOpts,
): Promise<boolean> {
  try {
    const address = walletAddress as `0x${string}`;
    const privateKey =
      opts?.privateKeyHex ??
      (await getOrCreateNostrKey({
        address,
        signMessage: async (message) => {
          const sig = await signer.signMessage(message);
          return sig as `0x${string}`;
        },
      }));
    return publishKind0Profile(data, walletAddress, privateKey, signer, {
      attestation: opts?.attestation,
    });
  } catch {
    return false;
  }
}
