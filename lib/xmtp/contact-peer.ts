import type { Dm } from "@xmtp/client";
import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import {
  peerReachabilityMessage,
  resolvePeerReachabilityFromProvider,
} from "@/lib/xmtp/can-message-peer";
import type { XmtpClient } from "@/lib/xmtp/helpers";
import { openDmWithPeer } from "@/lib/xmtp/open-dm";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export class ContactPeerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContactPeerError";
  }
}

function mapSdkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("inbox id for address") || message.includes("InboxIdForAddress")) {
    return "This user has not enabled messages yet.";
  }
  return "Could not open conversation.";
}

export type ContactPeerInput = {
  client: XmtpClient | null;
  ensureReady: () => Promise<XmtpClient | null>;
  peerAddress: `0x${string}`;
  nostrProfile?: NostrProfileData | null;
  provider?: unknown;
  chainId?: number;
};

export async function contactPeer(input: ContactPeerInput): Promise<Dm> {
  const chainId = input.chainId ?? DEFAULT_CHAIN_ID;
  const peer = getAddress(input.peerAddress);

  const reachability = await resolvePeerReachabilityFromProvider(
    peer,
    input.nostrProfile,
    input.provider,
    chainId,
  );
  if (!reachability.reachable) {
    const copy = peerReachabilityMessage(reachability.reason);
    throw new ContactPeerError(copy ?? "This address cannot receive messages.");
  }

  const activeClient = input.client ?? (await input.ensureReady());
  if (!activeClient) {
    throw new ContactPeerError("Connect your wallet and enable messages first.");
  }

  try {
    return await openDmWithPeer(activeClient, peer);
  } catch (error) {
    throw new ContactPeerError(mapSdkError(error));
  }
}
