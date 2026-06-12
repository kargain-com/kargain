"use client";

import type { Dm } from "@xmtp/client";
import { getAddress } from "viem";

import { ethereumIdentifier } from "@/lib/xmtp/client";
import type { XmtpClient } from "@/lib/xmtp/helpers";

export async function openDmWithPeer(
  client: XmtpClient,
  peerAddress: `0x${string}`,
): Promise<Dm> {
  const peer = getAddress(peerAddress);
  return client.conversations.createDmWithIdentifier(ethereumIdentifier(peer));
}
