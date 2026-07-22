import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

import type { XmtpDm, XmtpSdkClient } from "./adapters/xmtp-adapter";
import { openDmWithPeer } from "./adapters/xmtp-adapter";
import {
  peerReachabilityMessage,
  resolvePeerReachabilityFromProvider,
} from "./can-message-peer";

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
  client: XmtpSdkClient | null;
  ensureReady: () => Promise<XmtpSdkClient | null>;
  peerAddress: `0x${string}`;
  nostrProfile?: NostrProfileData | null;
  provider?: unknown;
};

export async function contactPeer(input: ContactPeerInput): Promise<XmtpDm> {
  const peer = getAddress(input.peerAddress);

  const reachability = await resolvePeerReachabilityFromProvider(
    peer,
    input.nostrProfile,
    input.provider,
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
