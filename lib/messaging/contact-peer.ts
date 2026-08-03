import { getAddress } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

import type { XmtpDm, XmtpSdkClient } from "./adapters/xmtp-adapter";
import {
  ensureXmtpModuleReady,
  isXmtpModuleReady,
  openDmWithPeer,
  probePeerRegistration,
} from "./adapters/xmtp-adapter";
import {
  peerReachabilityMessage,
  resolvePeerReachabilityFromProvider,
} from "./can-message-peer";

/**
 * Abort for click-path `probePeerRegistration` only (not a session op).
 * Covers the network `canMessage` round-trip only — the SDK module must
 * already be ready. Smaller: slow networks falsely report the peer
 * unreachable. Larger: Message seller waits longer before failing closed on
 * an unresponsive probe.
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

export type PeerRegistrationProbeResult =
  | { status: "registered" }
  | { status: "unregistered" }
  | { status: "unknown" };

/**
 * Click-path registration probe — not used by browse reachability.
 * Assumes the SDK module is ready (or returns unknown). Never loads the module.
 */
export async function checkXmtpReachable(
  address: `0x${string}`,
): Promise<PeerRegistrationProbeResult> {
  if (!isXmtpModuleReady()) {
    return { status: "unknown" };
  }

  const peer = getAddress(address);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PEER_REGISTRATION_DEADLINE_MS);
  try {
    const result = await probePeerRegistration(peer, controller.signal);
    return result.registered
      ? { status: "registered" }
      : { status: "unregistered" };
  } catch {
    return { status: "unknown" };
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

  // Same readiness owner as the session — outside any abort / wall deadline.
  await ensureXmtpModuleReady();

  const probe = await checkXmtpReachable(peer);
  if (probe.status === "unregistered") {
    throw new ContactPeerError(
      peerReachabilityMessage("not_registered") ?? "This user has not enabled messages yet.",
    );
  }
  if (probe.status === "unknown") {
    throw new ContactPeerError(
      peerReachabilityMessage("unknown") ??
        "Could not check whether this user can receive messages.",
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
