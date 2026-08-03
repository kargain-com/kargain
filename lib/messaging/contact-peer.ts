import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

import type { XmtpDm, XmtpSdkClient } from "./adapters/xmtp-adapter";
import { openDmWithPeer, probePeerRegistration } from "./adapters/xmtp-adapter";
import {
  peerReachabilityMessage,
  resolvePeerReachabilityFromProvider,
} from "./can-message-peer";

/**
 * Abort for click-path `probePeerRegistration` only (not a session op).
 * Smaller: slow networks falsely report the peer unreachable. Larger: Message
 * seller waits longer before failing closed on an unresponsive probe.
 */
export const PEER_REGISTRATION_DEADLINE_MS = 5_000;

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

/** Click-path registration probe — not used by browse reachability. */
export async function checkXmtpReachable(address: `0x${string}`): Promise<boolean> {
  const peer = getAddress(address);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PEER_REGISTRATION_DEADLINE_MS);
  try {
    const result = await probePeerRegistration(peer, controller.signal);
    return result.registered;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
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

  const registered = await checkXmtpReachable(peer);
  if (!registered) {
    throw new ContactPeerError(
      peerReachabilityMessage("not_registered") ?? "This user has not enabled messages yet.",
    );
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
