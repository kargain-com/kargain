"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { closeXmtpClient, useXmtpClient } from "@/hooks/use-xmtp-client";
import {
  deriveMessagingStatus,
  messagingStatusIsReady,
  messagingStatusNeedsSetup,
  type MessagingStatus,
} from "@/lib/xmtp/messaging-status";
import {
  clearMessagingDisabledLocally,
  clearOptedIn,
  hasOptedIn,
  isMessagingDisabledLocally,
  setMessagingDisabledLocally,
} from "@/lib/xmtp/messaging-preferences";
import {
  canInitializeMessaging,
  messagingWalletError,
  readAccountKindFromProvider,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

export function useMessagingStatus(): {
  status: MessagingStatus;
  client: ReturnType<typeof useXmtpClient>["client"];
  error: string | null;
  isReady: boolean;
  needsSetup: boolean;
  isInitializing: boolean;
  walletKind: WalletAccountKind | null;
  enableMessages: () => Promise<boolean>;
  disableMessages: () => void;
} {
  const { address, isConnected, connector } = useAccount();
  const { client, isInitializing, error, ensureInitialized } = useXmtpClient();
  const [walletKind, setWalletKind] = useState<WalletAccountKind | null>(null);

  const walletKey = address?.toLowerCase() ?? null;
  const optedIn = walletKey ? hasOptedIn(walletKey) : false;
  const disabledLocally = walletKey ? isMessagingDisabledLocally(walletKey) : false;

  useEffect(() => {
    if (!isConnected || !address) {
      setWalletKind(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      const provider = await connector?.getProvider?.();
      const kind = await readAccountKindFromProvider(provider, address);
      if (!cancelled) setWalletKind(kind);
    })();

    return () => {
      cancelled = true;
    };
  }, [address, connector, isConnected]);

  const status = useMemo(
    () =>
      deriveMessagingStatus({
        isConnected,
        walletKind,
        client,
        isInitializing,
        error,
        optedIn,
        disabledLocally,
      }),
    [client, disabledLocally, error, isConnected, isInitializing, optedIn, walletKind],
  );

  const enableMessages = useCallback(async (): Promise<boolean> => {
    if (!walletKey) return false;
    clearMessagingDisabledLocally(walletKey);
    const active = await ensureInitialized();
    return active !== null;
  }, [ensureInitialized, walletKey]);

  const disableMessages = useCallback(() => {
    if (!walletKey) return;
    setMessagingDisabledLocally(walletKey);
    clearOptedIn(walletKey);
    closeXmtpClient();
  }, [walletKey]);

  return {
    status,
    client,
    error,
    isReady: messagingStatusIsReady(status),
    needsSetup: messagingStatusNeedsSetup(status),
    isInitializing,
    walletKind,
    enableMessages,
    disableMessages,
  };
}

export function messagingUnsupportedCopy(kind: WalletAccountKind | null): string | null {
  if (kind === null) return null;
  return messagingWalletError(kind);
}

export function canWalletEnableMessaging(kind: WalletAccountKind | null): boolean {
  if (kind === null) return true;
  return canInitializeMessaging(kind);
}
