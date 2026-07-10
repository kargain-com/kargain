"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";

import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { useXmtpNetworkRegistration } from "@/hooks/use-xmtp-network-registration";
import { hasOptedIn } from "@/lib/xmtp/messaging-preferences";
import {
  deriveMessagingActivation,
  type MessagingActivationSnapshot,
} from "@/lib/xmtp/messaging-activation-state";

export function useMessagingActivation(): MessagingActivationSnapshot & {
  networkChecking: boolean;
  refetchNetwork: () => void;
} {
  const { address } = useAccount();
  const { isReady } = useMessagingStatus();
  const { profile, loading: nostrLoading } = useNostrProfile(address);
  const { networkRegistered, networkChecking, refetchNetwork } =
    useXmtpNetworkRegistration(address);

  const hasLocalOptIn = address ? hasOptedIn(address) : false;
  const nostrLoaded = !nostrLoading;

  const snapshot = useMemo(
    () =>
      deriveMessagingActivation({
        xmtpLocalReady: isReady,
        xmtpNetworkRegistered: networkRegistered,
        nostrProfile: profile,
        nostrLoaded,
        hasLocalOptIn,
      }),
    [hasLocalOptIn, isReady, nostrLoaded, networkRegistered, profile],
  );

  return {
    ...snapshot,
    networkChecking,
    refetchNetwork,
  };
}
