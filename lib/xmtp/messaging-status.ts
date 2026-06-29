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
  | "error";

export type DeriveMessagingStatusInput = {
  isConnected: boolean;
  walletKind: WalletAccountKind | null;
  client: XmtpClient | null;
  isInitializing: boolean;
  error: string | null;
  optedIn: boolean;
  disabledLocally: boolean;
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
  } = input;

  if (!isConnected) return "disconnected";

  if (walletKind !== null && !canInitializeMessaging(walletKind)) {
    return "unsupported";
  }

  if (disabledLocally) return "disabled";

  if (client) return "active";

  if (isInitializing) return "initializing";

  if (error) return "error";

  if (!optedIn) return "inactive";

  return "inactive";
}

export function messagingStatusNeedsSetup(status: MessagingStatus): boolean {
  return status === "inactive" || status === "error";
}

export function messagingStatusIsReady(status: MessagingStatus): boolean {
  return status === "active";
}
