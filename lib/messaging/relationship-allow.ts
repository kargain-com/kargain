/**
 * P9 on-chain relationship auto-allow.
 * Peers are derived only from indexer commercial-union reads — never from
 * message content or Nostr/profile display fields.
 */

import { getAddress, type Address, zeroAddress } from "viem";

import { getAccountObligations } from "@/app/actions/commerce-obligations";
import {
  getAgentMandates,
  getOwnerMandates,
} from "@/app/actions/commerce-mandates";
import { getOwnerPassportVerifierAddresses } from "@/app/actions/messaging-relationship";
import type { MandateRecord } from "@/lib/commerce/ponder-consignment";
import type { ObligationFacts } from "@/lib/obligation";

import type { ConsentState, XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  ethereumAddressFromInboxState,
  listDmsByConsent,
  MessagingConsentState,
  requestConsentStates,
  setConsentStatesByInboxId,
} from "./adapters/xmtp-adapter";

function tryAddress(raw: string | null | undefined): Address | null {
  if (!raw || raw === zeroAddress) return null;
  try {
    return getAddress(raw as `0x${string}`);
  } catch {
    return null;
  }
}

function addPeer(
  set: Set<string>,
  user: Address,
  candidate: string | null | undefined,
): void {
  const peer = tryAddress(candidate);
  if (!peer) return;
  if (peer.toLowerCase() === user.toLowerCase()) return;
  set.add(peer.toLowerCase());
}

/** Live consignment counterparties from obligation facts. */
export function peersFromObligationFacts(
  userAddress: Address,
  facts: ObligationFacts,
): Set<string> {
  const out = new Set<string>();
  if (facts.unresolved) return out;
  for (const row of facts.consignments) {
    addPeer(out, userAddress, row.seller);
    addPeer(out, userAddress, row.agent);
    addPeer(out, userAddress, row.buyer);
  }
  return out;
}

/** Active mandate counterparties (owner ↔ agent). */
export function peersFromMandates(
  userAddress: Address,
  ownerRows: readonly MandateRecord[],
  agentRows: readonly MandateRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const row of [...ownerRows, ...agentRows]) {
    addPeer(out, userAddress, row.owner);
    addPeer(out, userAddress, row.agent);
  }
  return out;
}

/** Recorded passport verifiers for passports the user owns. */
export function peersFromPassportVerifiers(
  userAddress: Address,
  verifiers: readonly string[],
): Set<string> {
  const out = new Set<string>();
  for (const verifier of verifiers) {
    addPeer(out, userAddress, verifier);
  }
  return out;
}

/**
 * Intersection of Unknown peers with the relationship set.
 * Message bodies and profile fields are intentionally not parameters.
 */
export function peersToAutoAllow(input: {
  unknownPeerAddresses: readonly string[];
  relationshipPeers: ReadonlySet<string>;
}): string[] {
  const out: string[] = [];
  for (const peer of input.unknownPeerAddresses) {
    const normalized = tryAddress(peer)?.toLowerCase();
    if (!normalized) continue;
    if (input.relationshipPeers.has(normalized)) out.push(normalized);
  }
  return out;
}

/**
 * Build the relationship peer set from indexer reads only.
 * Fail-closed when obligations are unresolved.
 */
export async function loadRelationshipPeerSet(
  userAddress: Address,
): Promise<Set<string>> {
  const [obligations, ownerMandates, agentMandates, verifiers] =
    await Promise.all([
      getAccountObligations(userAddress),
      getOwnerMandates(userAddress, { active: true, limit: 100 }),
      getAgentMandates(userAddress, { active: true, limit: 100 }),
      getOwnerPassportVerifierAddresses(userAddress),
    ]);

  const out = new Set<string>();
  for (const peer of peersFromObligationFacts(userAddress, obligations.facts)) {
    out.add(peer);
  }
  if (!ownerMandates.ponderError && !agentMandates.ponderError) {
    for (const peer of peersFromMandates(
      userAddress,
      ownerMandates.rows,
      agentMandates.rows,
    )) {
      out.add(peer);
    }
  }
  for (const peer of peersFromPassportVerifiers(userAddress, verifiers)) {
    out.add(peer);
  }
  return out;
}

/**
 * For Unknown DMs whose peer is in the relationship set, write Allowed.
 * Call on client attach and when a new Unknown conversation appears — not on
 * every inbox render.
 */
export async function applyRelationshipAllow(
  client: XmtpSdkClient,
  userAddress: Address,
): Promise<number> {
  const unknown = await listDmsByConsent(client, requestConsentStates());
  if (unknown.length === 0) return 0;

  const relationshipPeers = await loadRelationshipPeerSet(userAddress);
  if (relationshipPeers.size === 0) return 0;

  const peerInboxIds = await Promise.all(unknown.map((dm) => dm.peerInboxId()));
  const uniquePeerIds = [...new Set(peerInboxIds)];
  const inboxStates =
    uniquePeerIds.length > 0
      ? await client.preferences.getInboxStates(uniquePeerIds)
      : [];
  const addressByInbox = new Map(
    inboxStates.map((state) => {
      const eth = ethereumAddressFromInboxState(state);
      return [state.inboxId, eth] as const;
    }),
  );

  const records: Array<{ inboxId: string; state: ConsentState }> = [];
  for (let i = 0; i < unknown.length; i += 1) {
    const inboxId = peerInboxIds[i]!;
    const eth = addressByInbox.get(inboxId);
    if (!eth) continue;
    const allow = peersToAutoAllow({
      unknownPeerAddresses: [eth],
      relationshipPeers,
    });
    if (allow.length === 0) continue;
    records.push({ inboxId, state: MessagingConsentState.Allowed });
  }

  await setConsentStatesByInboxId(client, records);
  return records.length;
}
