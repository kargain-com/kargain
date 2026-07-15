"use client";

import { hexToBytes } from "viem";
import { finalizeEvent, type Event, type Filter } from "nostr-tools";

import {
  canonicalize,
  claimHash,
  parseClaim,
  type WmiClaim,
} from "@kargain/vincent/protocol";

import {
  getDefaultNostrPool,
  pubkeyFromPrivateKey,
  runSerializedPubkeyWrite,
} from "@/lib/nostr/app-event-store";
import { publishSignedEvent } from "@/lib/nostr/publish-event";

/**
 * F-2.1 Vincent Commons claim proposals (docs/research/vincent-flywheel.md
 * §10.2). Kind 31861 parameterized replaceable events carry an authored `wmi`
 * fact core: `d` = claimHash, `w` = WMI for discovery, content = JCS-canonical
 * claim. Integrity is content-addressing — the claim is unsigned by design;
 * trust comes from the kind 31860 endorse reviews attached to the claimHash.
 */
export const COMMONS_CLAIM_PROPOSAL_KIND = 31861;

const MAX_PROPOSAL_QUERY_LIMIT = 2000;

/** Single choke point for kind 31861 queries by WMI `w` tags. */
export function commonsClaimProposalFilterForWmis(wmis: string[]): Filter {
  const wTags = [...new Set(wmis)];
  return {
    kinds: [COMMONS_CLAIM_PROPOSAL_KIND],
    "#w": wTags,
    limit: Math.min(Math.max(wTags.length, 1) * 8, MAX_PROPOSAL_QUERY_LIMIT),
  };
}

/** Unsigned Nostr event template: d = claimHash, w = WMI, content = JCS claim. */
export type CommonsClaimProposalEventTemplate = {
  kind: typeof COMMONS_CLAIM_PROPOSAL_KIND;
  created_at: number;
  tags: string[][];
  content: string;
};

export function buildCommonsClaimProposalEvent(
  claim: WmiClaim,
  createdAt: number,
): CommonsClaimProposalEventTemplate {
  return {
    kind: COMMONS_CLAIM_PROPOSAL_KIND,
    created_at: createdAt,
    tags: [
      ["d", claimHash(claim)],
      ["w", claim.key.wmi],
    ],
    content: canonicalize(claim),
  };
}

type CommonsClaimProposalEventShape = {
  kind: number;
  tags: string[][];
  content: string;
};

export type CommonsWmiProposal = {
  claim: WmiClaim;
  claimHash: string;
};

/**
 * Parse a kind 31861 event into a wmi claim proposal. Fail-closed: wrong
 * kind, invalid JSON, non-`wmi` or invalid claim (`parseClaim`),
 * `claimHash(content)` ≠ `d` tag, or `w` tag ≠ `claim.key.wmi` all yield null.
 */
export function commonsWmiProposalFromEvent(
  event: CommonsClaimProposalEventShape,
): CommonsWmiProposal | null {
  if (event.kind !== COMMONS_CLAIM_PROPOSAL_KIND) return null;

  let json: unknown;
  try {
    json = JSON.parse(event.content);
  } catch {
    return null;
  }

  const parsed = parseClaim(json);
  if (!parsed.ok || parsed.value.type !== "wmi") return null;

  const hash = claimHash(parsed.value);
  const dTag = event.tags.find((tag) => tag[0] === "d")?.[1];
  if (dTag !== hash) return null;

  const wTag = event.tags.find((tag) => tag[0] === "w")?.[1];
  if (wTag !== parsed.value.key.wmi) return null;

  return { claim: parsed.value, claimHash: hash };
}

export type CommonsWmiProposalEntry = {
  proposal: CommonsWmiProposal;
  createdAt: number;
  eventId: string;
  /** First proposer — the §10.2 threshold's proposer identity. */
  authorPubkey: string;
};

export type CommonsWmiProposalBatchState = {
  /** claimHash → earliest valid proposal (dedupe across authors). */
  byClaimHash: Map<string, CommonsWmiProposalEntry>;
};

export function createEmptyCommonsWmiProposalState(): CommonsWmiProposalBatchState {
  return { byClaimHash: new Map() };
}

/**
 * Apply one incoming event: fail-closed parse, then dedupe identical
 * claimHashes across authors keeping the earliest event — NIP-01 tie
 * resolves to the lower id — so the first proposer stays attributed.
 */
export function applyCommonsWmiProposalEvent(
  state: CommonsWmiProposalBatchState,
  event: Pick<Event, "id" | "pubkey" | "kind" | "tags" | "content" | "created_at">,
): CommonsWmiProposalBatchState {
  const proposal = commonsWmiProposalFromEvent(event);
  if (!proposal) return state;

  const prev = state.byClaimHash.get(proposal.claimHash);
  if (
    prev &&
    (prev.createdAt < event.created_at ||
      (prev.createdAt === event.created_at && prev.eventId <= event.id))
  ) {
    return state;
  }

  const next = new Map(state.byClaimHash);
  next.set(proposal.claimHash, {
    proposal,
    createdAt: event.created_at,
    eventId: event.id,
    authorPubkey: event.pubkey,
  });
  return { byClaimHash: next };
}

export function commonsWmiProposalEntries(
  state: CommonsWmiProposalBatchState,
): CommonsWmiProposalEntry[] {
  return [...state.byClaimHash.values()];
}

function toPrivateKeyBytes(privateKey: string): Uint8Array {
  const hex = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  return hexToBytes(hex as `0x${string}`);
}

/**
 * Publish a wmi claim proposal as a kind 31861 event.
 * Fail-closed boolean — callers roll back optimistic state on `false`.
 */
export async function publishCommonsClaimProposal(
  claim: WmiClaim,
  nostrPrivateKey: string,
): Promise<boolean> {
  if (!nostrPrivateKey.trim()) return false;
  const pubkey = pubkeyFromPrivateKey(nostrPrivateKey);

  return runSerializedPubkeyWrite(pubkey, async () => {
    try {
      const pool = getDefaultNostrPool();
      const template = buildCommonsClaimProposalEvent(
        claim,
        Math.floor(Date.now() / 1000),
      );
      const signed = finalizeEvent(template, toPrivateKeyBytes(nostrPrivateKey));
      const result = await publishSignedEvent(pool, signed);
      return result.ok;
    } catch {
      return false;
    }
  });
}
