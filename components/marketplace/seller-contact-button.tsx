"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { openDmWithPeer } from "@/lib/xmtp/open-dm";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import {
  isMessageablePeer,
  messagingWalletError,
  readAccountKindFromProvider,
} from "@/lib/web3/wallet-account";

type Props = {
  peerAddress: `0x${string}`;
  label: string;
  listingTokenId?: string | null;
};

export function SellerContactButton({ peerAddress, label, listingTokenId: _listingTokenId }: Props) {
  const { address, isConnected, connector } = useAccount();
  const router = useRouter();
  const { isInitializing, error, ensureInitialized } = useXmtpClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (
    address &&
    peerAddress &&
    address.toLowerCase() === peerAddress.toLowerCase()
  ) {
    return null;
  }

  if (!isConnected) {
    return null;
  }

  if (!isMessageablePeer(peerAddress, DEFAULT_CHAIN_ID)) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        This seller cannot receive messages.
      </p>
    );
  }

  const handleClick = async () => {
    setActionError(null);
    setBusy(true);
    try {
      const provider = await connector?.getProvider?.();
      const peerKind = await readAccountKindFromProvider(provider, peerAddress);
      const peerError = messagingWalletError(peerKind);
      if (peerError) {
        setActionError(peerError);
        return;
      }

      const activeClient = await ensureInitialized();
      if (!activeClient) return;

      const conversation = await openDmWithPeer(activeClient, peerAddress);
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not open conversation.");
    } finally {
      setBusy(false);
    }
  };

  const displayError = actionError ?? error;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={busy || isInitializing}
        onClick={() => void handleClick()}
        aria-label={label}
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {busy || isInitializing ? "Opening…" : label}
      </Button>
      {displayError && (
        <p className="text-sm text-status-error" role="alert">
          {displayError}
        </p>
      )}
    </div>
  );
}
