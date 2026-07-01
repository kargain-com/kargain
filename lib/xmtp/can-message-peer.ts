import { Client } from "@xmtp/client";
import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { isMessagesAccepting } from "@/lib/nostr/messages-enabled";
import { ethereumIdentifier, getXmtpEnv } from "@/lib/xmtp/client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import {
  isMessageablePeer,
  messagingWalletError,
  readAccountKind,
  readAccountKindFromProvider,
} from "@/lib/web3/wallet-account";

export type PeerReachabilityReason =
  | "disabled"
  | "not_registered"
  | "protocol"
  | "contract"
  | null;

export function peerAcceptsMessages(profile: NostrProfileData | null | undefined): boolean {
  return isMessagesAccepting(profile);
}

export async function checkXmtpReachable(address: `0x${string}`): Promise<boolean> {
  const peer = getAddress(address);
  const identifier = ethereumIdentifier(peer);
  const response = await Client.canMessage([identifier], getXmtpEnv());
  return response.get(identifier.identifier) === true;
}

export async function resolvePeerReachability(
  peerAddress: `0x${string}`,
  nostrProfile: NostrProfileData | null | undefined,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{ reachable: boolean; reason: PeerReachabilityReason }> {
  if (!isMessageablePeer(peerAddress, chainId)) {
    return { reachable: false, reason: "protocol" };
  }

  if (!peerAcceptsMessages(nostrProfile)) {
    return { reachable: false, reason: "disabled" };
  }

  const kind = await readAccountKind(chainId, peerAddress);
  if (messagingWalletError(kind)) {
    return { reachable: false, reason: "contract" };
  }

  const registered = await checkXmtpReachable(peerAddress);
  if (!registered) {
    return { reachable: false, reason: "not_registered" };
  }

  return { reachable: true, reason: null };
}

export function peerReachabilityMessage(reason: PeerReachabilityReason): string | null {
  switch (reason) {
    case "disabled":
      return "This user is not accepting messages.";
    case "not_registered":
      return "This user has not enabled messages yet.";
    case "protocol":
    case "contract":
      return "This address cannot receive messages.";
    default:
      return null;
  }
}

export async function resolvePeerReachabilityFromProvider(
  peerAddress: `0x${string}`,
  nostrProfile: NostrProfileData | null | undefined,
  provider: unknown,
  chainId: number = DEFAULT_CHAIN_ID,
): Promise<{ reachable: boolean; reason: PeerReachabilityReason }> {
  if (!isMessageablePeer(peerAddress, chainId)) {
    return { reachable: false, reason: "protocol" };
  }

  if (!peerAcceptsMessages(nostrProfile)) {
    return { reachable: false, reason: "disabled" };
  }

  const kind = await readAccountKindFromProvider(provider, peerAddress);
  if (messagingWalletError(kind)) {
    return { reachable: false, reason: "contract" };
  }

  const registered = await checkXmtpReachable(peerAddress);
  if (!registered) {
    return { reachable: false, reason: "not_registered" };
  }

  return { reachable: true, reason: null };
}
