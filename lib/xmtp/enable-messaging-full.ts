import type { Address } from "viem";
import type { WalletClient } from "viem";

import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import {
  publishNostrProfile,
  type PublishNostrProfileOpts,
} from "@/lib/nostr/profile";
import { verifyMessagingActivation } from "@/lib/xmtp/verify-messaging-activation";

export type EnableMessagingFullStep = "xmtp" | "nostr" | "verify";

export type EnableMessagingFullVerifyDetail = "network" | "relay";

export type EnableMessagingFullResult = {
  ok: boolean;
  step: EnableMessagingFullStep | null;
  verifyDetail?: EnableMessagingFullVerifyDetail;
};

export type PublishProfileFn = (
  data: NostrProfileData,
  address: Address,
  signer: { signMessage: (msg: string) => Promise<string> },
  opts?: PublishNostrProfileOpts,
) => Promise<boolean>;

export type EnableMessagingFullInput = {
  enableMessages: () => Promise<boolean>;
  address: Address;
  walletClient: WalletClient;
  /** Attested profile read result — drives expectExisting on Nostr publish only. */
  profile: NostrProfileData | null | undefined;
  /** When true, skip XMTP init and only publish Nostr preference (split-state recovery). */
  xmtpAlreadyActive?: boolean;
  /** When true, skip post-enable network/relay verification (tests only). */
  skipVerify?: boolean;
  /** Tests only — override publishNostrProfile to capture patch shape. */
  publishProfile?: PublishProfileFn;
};

/** Enable XMTP messaging, publish Nostr messagesEnabled: true, and verify network + relay. */
export async function enableMessagingFull(
  input: EnableMessagingFullInput,
): Promise<EnableMessagingFullResult> {
  if (!input.xmtpAlreadyActive) {
    const xmtpOk = await input.enableMessages();
    if (!xmtpOk) {
      return { ok: false, step: "xmtp" };
    }
  }

  const publish = input.publishProfile ?? publishNostrProfile;
  const nostrOk = await publish(
    { messagesEnabled: true },
    input.address,
    {
      signMessage: (msg) =>
        input.walletClient.signMessage({ account: input.address, message: msg }),
    },
    { expectExisting: input.profile != null },
  );

  if (!nostrOk) {
    return { ok: false, step: "nostr" };
  }

  if (input.skipVerify) {
    return { ok: true, step: null };
  }

  const verified = await verifyMessagingActivation(input.address);
  if (!verified.ok) {
    return { ok: false, step: "verify", verifyDetail: verified.detail };
  }

  return { ok: true, step: null };
}

export function enableMessagingFullError(
  step: EnableMessagingFullStep | null,
  verifyDetail?: EnableMessagingFullVerifyDetail,
): string {
  switch (step) {
    case "xmtp":
      return "Could not enable messages. Try again.";
    case "nostr":
      return "Could not save your messaging preference.";
    case "verify":
      if (verifyDetail === "network") {
        return "Messages are not registered on the network yet. Try again.";
      }
      if (verifyDetail === "relay") {
        return "Your profile still shows messages as off. Try again.";
      }
      return "Could not verify private messages are active. Try again.";
    default:
      return "Could not enable messages. Try again.";
  }
}

export type DisableMessagingInput = {
  address: Address;
  walletClient: WalletClient;
  profile: NostrProfileData | null | undefined;
  publishPreference: (messagesEnabled: boolean) => Promise<boolean>;
  disableMessages: () => void;
};

export type DisableMessagingResult = {
  ok: boolean;
  step: "nostr" | null;
};

/** Publish opt-out first; tear down XMTP only after relay publish succeeds. */
export async function disableMessagingFull(
  input: DisableMessagingInput,
): Promise<DisableMessagingResult> {
  const nostrOk = await input.publishPreference(false);
  if (!nostrOk) {
    return { ok: false, step: "nostr" };
  }

  input.disableMessages();
  return { ok: true, step: null };
}

export function disableMessagingError(step: DisableMessagingResult["step"]): string {
  if (step === "nostr") {
    return "Could not turn off private messages. Your messaging is still active.";
  }
  return "Could not turn off private messages.";
}
