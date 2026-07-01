"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { hasOptedIn } from "@/lib/xmtp/messaging-preferences";
import {
  deriveMessagingActivation,
  type MessagingActivationSnapshot,
} from "@/lib/xmtp/messaging-activation-state";
import { checkXmtpReachable } from "@/lib/xmtp/can-message-peer";

export function useMessagingActivation(): MessagingActivationSnapshot & {
  networkChecking: boolean;
  refetchNetwork: () => void;
} {
  const { address } = useAccount();
  const { isReady } = useMessagingStatus();
  const { profile, loading: nostrLoading } = useNostrProfile(address);
  const [xmtpNetworkRegistered, setXmtpNetworkRegistered] = useState(false);
  const [networkChecking, setNetworkChecking] = useState(false);
  const [networkChecked, setNetworkChecked] = useState(false);

  const hasLocalOptIn = address ? hasOptedIn(address) : false;

  const checkNetwork = useCallback(async () => {
    if (!address || !isReady) {
      setXmtpNetworkRegistered(false);
      setNetworkChecked(true);
      return;
    }

    setNetworkChecking(true);
    try {
      const registered = await checkXmtpReachable(address);
      setXmtpNetworkRegistered(registered);
    } catch {
      setXmtpNetworkRegistered(false);
    } finally {
      setNetworkChecking(false);
      setNetworkChecked(true);
    }
  }, [address, isReady]);

  useEffect(() => {
    void checkNetwork();
  }, [checkNetwork]);

  const nostrLoaded = !nostrLoading;

  const snapshot = useMemo(
    () =>
      deriveMessagingActivation({
        xmtpLocalReady: isReady,
        xmtpNetworkRegistered: isReady ? xmtpNetworkRegistered : false,
        nostrProfile: profile,
        nostrLoaded,
        hasLocalOptIn,
      }),
    [hasLocalOptIn, isReady, nostrLoaded, profile, xmtpNetworkRegistered],
  );

  return {
    ...snapshot,
    networkChecking: isReady && (networkChecking || !networkChecked),
    refetchNetwork: () => void checkNetwork(),
  };
}
