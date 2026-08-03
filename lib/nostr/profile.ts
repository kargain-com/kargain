"use client";

import { type Address, hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import {
  getDefaultNostrPool,
  runSerializedPubkeyWrite,
} from "@/lib/nostr/app-event-store";
import { getOrCreateNostrKey } from "@/lib/nostr/key-manager";
import {
  fetchLatestKind0RawByAuthor,
  mergeKind0Content,
  type Kind0MergeReadResult,
} from "@/lib/nostr/merge-kind0-content";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
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
import { saveCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";

export type { NostrProfileData, ProfileAttestationV1 } from "@/lib/nostr/parse-profile-content";

export type PublishNostrProfileOpts = {
  /**
   * When set, skips `getOrCreateNostrKey` (tests / callers that already hold
   * the key). Still runs inside the per-pubkey serializer with one coverage read.
   */
  privateKeyHex?: string;
  /** When set, replaces attestation on the merged content. */
  attestation?: ProfileAttestationV1;
};

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
 * Sign + publish from an already-fetched merge base (exactly one coverage read
 * must have produced `base` for this write).
 */
async function publishFromMergeBase(opts: {
  data: NostrProfileData;
  address: `0x${string}`;
  privateKeyHex: string;
  base: Extract<Kind0MergeReadResult, { status: "answered" }>;
  attestation?: ProfileAttestationV1;
}): Promise<boolean> {
  const { data, address, privateKeyHex, base, attestation } = opts;
  const content = mergeKind0Content(base.content, data);
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
  const pool = getDefaultNostrPool();
  const { ok } = await publishSignedEvent(pool, signed, {
    relays: base.answeredRelays,
  });
  return ok;
}

/**
 * Sole kind:0 writer: one coverage read, one merge, one publish, inside the
 * per-pubkey serializer. Profile edit, KarPro payments, and messaging intent
 * all call this. Never throws.
 */
export async function publishNostrProfile(
  data: NostrProfileData,
  walletAddress: Address,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts?: PublishNostrProfileOpts,
): Promise<boolean> {
  try {
    const address = toWalletAddress(walletAddress);
    const privateKey =
      opts?.privateKeyHex ??
      (await getOrCreateNostrKey({
        address,
        signMessage: async (message) => {
          const sig = await signer.signMessage(message);
          return sig as `0x${string}`;
        },
      }));
    const pubkey = nostrPubkeyFromPrivateKey(privateKey);
    saveCachedPubkey(address, pubkey);

    return await runSerializedPubkeyWrite(pubkey, async () => {
      const pool = getDefaultNostrPool();
      const base = await fetchLatestKind0RawByAuthor(pubkey, { pool });
      if (base.status === "unanswered") {
        return false;
      }

      // Key-holder / test path: optional attestation override; no second coverage.
      if (opts?.privateKeyHex) {
        return publishFromMergeBase({
          data,
          address,
          privateKeyHex: privateKey,
          base,
          attestation: opts.attestation,
        });
      }

      if (opts?.attestation) {
        return publishFromMergeBase({
          data,
          address,
          privateKeyHex: privateKey,
          base,
          attestation: opts.attestation,
        });
      }

      const hasValidAttestation = await verifyProfileAttestationCore(
        { id: `write:${pubkey}`, pubkey, content: JSON.stringify(base.content) },
        address,
      );

      if (hasValidAttestation) {
        return publishFromMergeBase({
          data,
          address,
          privateKeyHex: privateKey,
          base,
        });
      }

      const attestationSig = (await signer.signMessage(
        attestationMessage(pubkey, address),
      )) as `0x${string}`;
      const attestation = buildProfileAttestation({
        pubkey,
        address,
        signature: attestationSig,
      });
      return publishFromMergeBase({
        data,
        address,
        privateKeyHex: privateKey,
        base,
        attestation,
      });
    });
  } catch {
    return false;
  }
}
