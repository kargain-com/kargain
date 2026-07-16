"use client";

import { getAddress, type Address } from "viem";
import type { WalletClient } from "viem";

import { resolveAttestedProfile } from "@/lib/nostr/resolve-attested-profile";
import {
  publishNostrProfile,
  type PublishNostrProfileOpts,
} from "@/lib/nostr/profile";
import type { NostrPolicyPort } from "../ports";

export type CreateNostrPolicyAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
  getAddress: () => Address | null;
};

export function createNostrPolicyAdapter(input: CreateNostrPolicyAdapterInput): NostrPolicyPort {
  return {
    async readIntent(address) {
      const profile = await resolveAttestedProfile(getAddress(address as Address));
      if (!profile) return null;
      if (profile.messagesEnabled === true) return true;
      if (profile.messagesEnabled === false) return false;
      return null;
    },

    async publishIntent(address, enabled) {
      const walletClient = input.getWalletClient();
      const signerAddress = input.getAddress();
      if (!walletClient || !signerAddress) {
        return { ok: false, reason: "publish_failed" };
      }

      const profile = await resolveAttestedProfile(getAddress(address as Address));
      const opts: PublishNostrProfileOpts = {
        expectExisting: profile != null,
      };

      const ok = await publishNostrProfile(
        { messagesEnabled: enabled },
        signerAddress,
        {
          signMessage: (msg) =>
            walletClient.signMessage({ account: signerAddress, message: msg }),
        },
        opts,
      );

      return ok ? { ok: true } : { ok: false, reason: "publish_failed" };
    },
  };
}
