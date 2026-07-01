import type { Address } from "viem";
import type { WalletClient } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { publishNostrProfile } from "@/lib/nostr/profile";

export type EnableMessagingFullStep = "xmtp" | "nostr";

export type EnableMessagingFullResult = {
  ok: boolean;
  step: EnableMessagingFullStep | null;
};

export type EnableMessagingFullInput = {
  enableMessages: () => Promise<boolean>;
  address: Address;
  walletClient: WalletClient;
  profile: NostrProfileData | null | undefined;
  /** When true, skip XMTP init and only publish Nostr preference (split-state recovery). */
  xmtpAlreadyActive?: boolean;
};

/** Enable XMTP messaging and publish Nostr messagesEnabled: true. */
export async function enableMessagingFull(
  input: EnableMessagingFullInput,
): Promise<EnableMessagingFullResult> {
  if (!input.xmtpAlreadyActive) {
    const xmtpOk = await input.enableMessages();
    if (!xmtpOk) {
      return { ok: false, step: "xmtp" };
    }
  }

  const nostrOk = await publishNostrProfile(
    {
      name: input.profile?.name,
      about: input.profile?.about,
      picture: input.profile?.picture,
      website: input.profile?.website,
      messagesEnabled: true,
    },
    input.address,
    {
      signMessage: (msg) =>
        input.walletClient.signMessage({ account: input.address, message: msg }),
    },
  );

  if (!nostrOk) {
    return { ok: false, step: "nostr" };
  }

  return { ok: true, step: null };
}

export function enableMessagingFullError(step: EnableMessagingFullStep | null): string {
  switch (step) {
    case "xmtp":
      return "Could not enable messages. Try again.";
    case "nostr":
      return "Could not save your messaging preference.";
    default:
      return "Could not enable messages. Try again.";
  }
}
