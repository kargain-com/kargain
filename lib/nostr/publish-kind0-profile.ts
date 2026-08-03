"use client";

import { type Address, hexToBytes } from "viem";
import { finalizeEvent } from "nostr-tools";

import {
  getDefaultNostrPool,
  runSerializedPubkeyWrite,
} from "@/lib/nostr/app-event-store";
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
import { nostrPubkeyFromPrivateKey } from "@/lib/nostr/nostr-client";
import { publishSignedEvent } from "@/lib/nostr/publish-event";
import { saveCachedPubkey } from "@/lib/nostr/nostr-pubkey-cache";

export type PublishKind0ProfileOpts = {
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
 * Kind:0 publish when the caller already holds the private key (no key-manager).
 * Still runs attestation verify → optional wallet `signMessage` when missing.
 * Never throws.
 */
export async function publishKind0Profile(
  data: NostrProfileData,
  walletAddress: Address,
  privateKeyHex: string,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts?: PublishKind0ProfileOpts,
): Promise<boolean> {
  try {
    const address = toWalletAddress(walletAddress);
    const pubkey = nostrPubkeyFromPrivateKey(privateKeyHex);
    saveCachedPubkey(address, pubkey);

    return await runSerializedPubkeyWrite(pubkey, async () => {
      const pool = getDefaultNostrPool();
      const base = await fetchLatestKind0RawByAuthor(pubkey, { pool });
      if (base.status === "unanswered") {
        return false;
      }

      if (opts?.attestation) {
        return publishFromMergeBase({
          data,
          address,
          privateKeyHex,
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
          privateKeyHex,
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
        privateKeyHex,
        base,
        attestation,
      });
    });
  } catch {
    return false;
  }
}
