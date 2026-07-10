"use client";

import { useCallback, useMemo } from "react";
import { useAccount } from "wagmi";

import { useWalletAccountKind } from "@/hooks/use-wallet-account-kind";
import { useXmtpNetworkRegistration } from "@/hooks/use-xmtp-network-registration";
import { closeXmtpClient, useXmtpClient } from "@/hooks/use-xmtp-client";
import {
  deriveMessagingStatus,
  messagingStatusIsReady,
  messagingStatusNeedsDeviceRestore,
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
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

export function useMessagingStatus(): {
  status: MessagingStatus;
  client: ReturnType<typeof useXmtpClient>["client"];
  error: string | null;
  isReady: boolean;
  needsSetup: boolean;
  needsDeviceRestore: boolean;
  isInitializing: boolean;
  walletKind: WalletAccountKind | null;
  enableMessages: () => Promise<boolean>;
  disableMessages: () => void;
} {
  const { address, isConnected, connector } = useAccount();
  const { client, isInitializing, error, deviceRestoreFailed, ensureInitialized } = useXmtpClient();
  const { kind: walletKind } = useWalletAccountKind(
    isConnected ? address : undefined,
    connector,
  );
  const { networkRegistered, networkChecking } = useXmtpNetworkRegistration(address);

  const walletKey = address?.toLowerCase() ?? null;
  const optedIn = walletKey ? hasOptedIn(walletKey) : false;
  const disabledLocally = walletKey ? isMessagingDisabledLocally(walletKey) : false;

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
        networkRegistered,
        networkCheckPending: networkChecking,
        deviceRestoreFailed,
      }),
    [
      client,
      deviceRestoreFailed,
      disabledLocally,
      error,
      isConnected,
      isInitializing,
      networkChecking,
      networkRegistered,
      optedIn,
      walletKind,
    ],
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
    needsDeviceRestore: messagingStatusNeedsDeviceRestore(status),
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
