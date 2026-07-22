import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { isMessagesAccepting } from "@/lib/nostr/messages-enabled";
import {
  isMessageablePeerOnCommercialChains,
  messagingWalletError,
  readAccountKind,
  readAccountKindFromProvider,
  readAccountKindOnCommercialChains,
} from "@/lib/web3/wallet-account";

import { PROBE_DEADLINE_MS } from "./ports";
import { probePeerRegistration } from "./adapters/xmtp-adapter";

export type PeerReachabilityReason =
  | "disabled"
  | "not_registered"
  | "protocol"
  | "contract"
  | null;

const peerProbePort = { probeRegistration: probePeerRegistration };

export function peerAcceptsMessages(profile: NostrProfileData | null | undefined): boolean {
  return isMessagesAccepting(profile);
}

export async function checkXmtpReachable(address: `0x${string}`): Promise<boolean> {
  const peer = getAddress(address);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_DEADLINE_MS);
  try {
    const result = await peerProbePort.probeRegistration(peer, controller.signal);
    return result.registered;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function peerAccountKind(
  peerAddress: `0x${string}`,
  chainId?: number | null,
) {
  if (chainId != null) return readAccountKind(chainId, peerAddress);
  return readAccountKindOnCommercialChains(peerAddress);
}

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

  const registered = await checkXmtpReachable(peerAddress);
  if (!registered) {
    return { reachable: false, reason: "not_registered" };
  }

  return { reachable: true, reason: null };
}
