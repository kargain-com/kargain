import type { Address } from "viem";

import { isMessagesAccepting } from "@/lib/nostr/messages-enabled";
import { fetchNostrProfileByEthereumTag } from "@/lib/nostr/profile";
import { checkXmtpReachable } from "@/lib/xmtp/can-message-peer";

const VERIFY_POLL_MS = 500;
const VERIFY_TIMEOUT_MS = 10_000;

export type VerifyMessagingActivationDetail = "network" | "relay";

/** Poll XMTP network until address is registered or timeout. */
export async function waitForXmtpNetworkRegistration(
  address: Address,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await checkXmtpReachable(address)) return true;
    } catch {
      /* network may be warming up */
    }
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }
  return checkXmtpReachable(address).catch(() => false);
}

/** Confirm relay profile accepts messages after publish. */
export async function verifyRelayMessagesAccepting(
  address: Address,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const profile = await fetchNostrProfileByEthereumTag(address, 2500);
    if (profile && isMessagesAccepting(profile)) return true;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
  }
  const profile = await fetchNostrProfileByEthereumTag(address, 2500);
  return isMessagesAccepting(profile);
}

export async function verifyMessagingActivation(
  address: Address,
): Promise<{ ok: true } | { ok: false; detail: VerifyMessagingActivationDetail }> {
  const networkOk = await waitForXmtpNetworkRegistration(address);
  if (!networkOk) {
    return { ok: false, detail: "network" };
  }

  const relayOk = await verifyRelayMessagesAccepting(address);
  if (!relayOk) {
    return { ok: false, detail: "relay" };
  }

  return { ok: true };
}
