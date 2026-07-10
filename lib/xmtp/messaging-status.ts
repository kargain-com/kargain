import type { WalletAccountKind } from "@/lib/web3/wallet-account";
import { canInitializeMessaging } from "@/lib/web3/wallet-account";

import type { XmtpClient } from "@/lib/xmtp/helpers";

export type MessagingStatus =
  | "disconnected"
  | "unsupported"
  | "disabled"
  | "inactive"
  | "initializing"
  | "active"
  | "error"
  | "restore_required";

export type DeriveMessagingStatusInput = {
  isConnected: boolean;
  walletKind: WalletAccountKind | null;
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  optedIn: boolean;
  disabledLocally: boolean;
  networkRegistered: boolean;
  networkCheckPending?: boolean;
  deviceRestoreFailed: boolean;
};

export function deriveMessagingStatus(input: DeriveMessagingStatusInput): MessagingStatus {
  const {
    isConnected,
    walletKind,
    client,
    isInitializing,
    error,
    optedIn,
    disabledLocally,
    networkRegistered,
    networkCheckPending = false,
    deviceRestoreFailed,
  } = input;

  if (!isConnected) return "disconnected";

  if (walletKind !== null && !canInitializeMessaging(walletKind)) {
    return "unsupported";
  }

  if (disabledLocally) return "disabled";

  if (client) return "active";

  if (isInitializing) return "initializing";

  if (error) return "error";

  if (!client && deviceRestoreFailed && (optedIn || networkRegistered)) {
    return "restore_required";
  }

  if (!optedIn) {
    if (networkRegistered || networkCheckPending) return "initializing";
    return "inactive";
  }

  // Opted in locally but client not restored yet (reconnect / auto-init pending).
  return "initializing";
}

export function messagingStatusNeedsSetup(status: MessagingStatus): boolean {
  return status === "inactive" || status === "error";
}

export function messagingStatusNeedsDeviceRestore(status: MessagingStatus): boolean {
  return status === "restore_required";
}

export function messagingStatusIsReady(status: MessagingStatus): boolean {
  return status === "active";
}
