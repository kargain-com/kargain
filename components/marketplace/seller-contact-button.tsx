"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { useXmtpClient } from "@/hooks/use-xmtp-client";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { ContactPeerError, contactPeer } from "@/lib/xmtp/contact-peer";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import { isMessageablePeer } from "@/lib/web3/wallet-account";

type Props = {
  peerAddress: `0x${string}`;
  label: string;
  listingTokenId?: string | null;
};

function buildListingInquiryMessage(tokenId: string): string {
  return `Hi, I'm interested in your listing for ${formatPassportTitle(tokenId)}.`;
}

export function SellerContactButton({ peerAddress, label, listingTokenId }: Props) {
  const { address, isConnected, connector } = useAccount();
  const router = useRouter();
  const { client, ensureInitialized } = useXmtpClient();
  const { isInitializing, error, needsSetup, enableMessages } = useMessagingStatus();
  const { profile: peerProfile } = useNostrProfile(peerAddress);
  const { reachable, message, isLoading } = usePeerMessagingReachability(peerAddress);
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

  if (!isLoading && !reachable && message) {
    return (
      <p className="text-sm text-text-secondary" role="status">
        {message}
      </p>
    );
  }

  const handleClick = async () => {
    setActionError(null);
    setBusy(true);
    try {
      if (needsSetup) {
        const enabled = await enableMessages();
        if (!enabled) return;
      }

      const activeClient = client ?? (await ensureInitialized());
      if (!activeClient) return;

      const provider = await connector?.getProvider?.();
      const conversation = await contactPeer({
        client: activeClient,
        ensureReady: ensureInitialized,
        peerAddress,
        nostrProfile: peerProfile,
        provider,
      });
      if (listingTokenId) {
        const last = await conversation.lastMessage();
        if (!last) {
          await conversation.sendText(buildListingInquiryMessage(listingTokenId));
        }
      }
      router.push(`/messages/${conversation.id}`);
    } catch (e) {
      setActionError(
        e instanceof ContactPeerError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Could not open conversation.",
      );
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
        disabled={busy || isInitializing || isLoading}
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
