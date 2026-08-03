"use client";

import { getAddress, type Address } from "viem";
import type { WalletClient } from "viem";

import {
  hasValidMessagingAttestation,
  publishMessagingIntent,
  readMessagingIntent,
} from "@/lib/nostr/messaging-intent";
import type { NostrIdentityCapability, NostrPolicyPort } from "../ports";

export type CreateNostrPolicyAdapterInput = {
  getWalletClient: () => WalletClient | undefined;
  getAddress: () => Address | null;
  identity: NostrIdentityCapability;
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

      const obtained = await input.identity.obtainKey();
      if (obtained.status === "declined") {
        return { ok: false, reason: "signature_declined" };
      }
      if (obtained.status === "error" || obtained.status === "unavailable") {
        return { ok: false, reason: "publish_failed" };
      }

      const ok = await publishMessagingIntent(
        getAddress(address as Address),
        enabled,
        {
          signMessage: (msg) =>
            walletClient.signMessage({ account: signerAddress, message: msg }),
        },
        { privateKeyHex: obtained.privateKey },
      );

      if (ok) {
        input.identity.markAttestationValid(true);
      }
      return ok ? { ok: true } : { ok: false, reason: "publish_failed" };
    },

    isKeyHeld() {
      return input.identity.isKeyHeld();
    },

    getAttestationValidCached() {
      return input.identity.getAttestationValidCached();
    },

    async probeAttestationValid(address) {
      const valid = await hasValidMessagingAttestation(getAddress(address as Address));
      input.identity.markAttestationValid(valid);
      return valid;
    },
  };
}
