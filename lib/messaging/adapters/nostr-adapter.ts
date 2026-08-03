"use client";

import { getAddress, type Address } from "viem";
import type { WalletClient } from "viem";

import {
  publishMessagingIntent,
  readMessagingIntent,
} from "@/lib/nostr/messaging-intent";
import type { NostrPolicyPort } from "../ports";

export type CreateNostrPolicyAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
  getAddress: () => Address | null;
};

export function createNostrPolicyAdapter(input: CreateNostrPolicyAdapterInput): NostrPolicyPort {
  return {
    async readIntent(address) {
      return readMessagingIntent(getAddress(address as Address));
    },

    async publishIntent(address, enabled) {
      const walletClient = input.getWalletClient();
      const signerAddress = input.getAddress();
      if (!walletClient || !signerAddress) {
        return { ok: false, reason: "publish_failed" };
      }

      const ok = await publishMessagingIntent(
        getAddress(address as Address),
        enabled,
        {
          signMessage: (msg) =>
            walletClient.signMessage({ account: signerAddress, message: msg }),
        },
      );

      return ok ? { ok: true } : { ok: false, reason: "publish_failed" };
    },
  };
}
