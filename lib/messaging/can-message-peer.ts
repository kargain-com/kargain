import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { isMessagesAccepting } from "@/lib/nostr/messages-enabled";
import {
  isMessageablePeerOnCommercialChains,
  messagingWalletError,
  readAccountKind,
  readAccountKindFromProvider,
  readAccountKindOnCommercialChains,
} from "@/lib/web3/wallet-account";

export type PeerReachabilityReason =
  | "disabled"
  | "not_registered"
  | "unknown"
  | "protocol"
  | "contract"
  | null;

export function peerAcceptsMessages(profile: NostrProfileData | null | undefined): boolean {
  return isMessagesAccepting(profile);
}

async function peerAccountKind(
  peerAddress: `0x${string}`,
  chainId?: number | null,
) {
  if (chainId != null) return readAccountKind(chainId, peerAddress);
  return readAccountKindOnCommercialChains(peerAddress);
}

/** Browse CTA — intent + protocol + account-kind. No XMTP registration probe. */
export async function resolvePeerReachability(
  peerAddress: `0x${string}`,
  nostrProfile: NostrProfileData | null | undefined,
  chainId?: number | null,
): Promise<{ reachable: boolean; reason: PeerReachabilityReason }> {
  if (!isMessageablePeerOnCommercialChains(peerAddress)) {
    return { reachable: false, reason: "protocol" };
  }

  if (!peerAcceptsMessages(nostrProfile)) {
    return { reachable: false, reason: "disabled" };
  }

  const kind = await peerAccountKind(peerAddress, chainId);
  if (messagingWalletError(kind)) {
    return { reachable: false, reason: "contract" };
  }

  return { reachable: true, reason: null };
}

export function peerReachabilityMessage(reason: PeerReachabilityReason): string | null {
  switch (reason) {
    case "disabled":
      return "This user is not accepting messages.";
    case "not_registered":
      return "This user has not enabled messages yet.";
    case "unknown":
      // Incomplete probe — about our check, not a claim about the peer.
      return "Could not check whether this user can receive messages.";
    case "protocol":
    case "contract":
      return "This address cannot receive messages.";
    default:
      return null;
  }
}

/** Browse CTA via injected provider — same gates as resolvePeerReachability (no XMTP). */
export async function resolvePeerReachabilityFromProvider(
  peerAddress: `0x${string}`,
  nostrProfile: NostrProfileData | null | undefined,
  provider: unknown,
): Promise<{ reachable: boolean; reason: PeerReachabilityReason }> {
  if (!isMessageablePeerOnCommercialChains(peerAddress)) {
    return { reachable: false, reason: "protocol" };
  }

  if (!peerAcceptsMessages(nostrProfile)) {
    return { reachable: false, reason: "disabled" };
  }

  const kind = await readAccountKindFromProvider(provider, peerAddress);
  if (messagingWalletError(kind)) {
    return { reachable: false, reason: "contract" };
  }

  return { reachable: true, reason: null };
}
