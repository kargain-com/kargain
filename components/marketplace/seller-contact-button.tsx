"use client";

import { CommentIcon } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { ContactPeerError, contactPeer } from "@/lib/messaging/contact-peer";
import { awaitActiveSnapshot, needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { formatPassportTitle } from "@/lib/passport/passport-token-id";
import { isMessageablePeerOnCommercialChains } from "@/lib/web3/wallet-account";

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
  const { snapshot, dispatch, session } = useMessagingSession();
  const needsMessagingSetup = needsMessagingSetupCard(snapshot);
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

  if (!isMessageablePeerOnCommercialChains(peerAddress)) {
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
    session?.requestLocalClient();
    try {
      if (needsMessagingSetup) {
        dispatch({ type: "enable" });
      }

      if (!session) return;
      await awaitActiveSnapshot(session);

      const activeClient = session.getXmtpClient();
      if (!activeClient) return;

      const provider = await connector?.getProvider?.();
      const conversation = await contactPeer({
        client: activeClient,
        ensureReady: async () => session.getXmtpClient(),
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
      session?.releaseLocalClient();
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={busy || isLoading}
        onClick={() => void handleClick()}
        aria-label={label}
      >
        <CommentIcon size={16} className="h-4 w-4" aria-hidden />
        {busy ? "Opening…" : label}
      </Button>
      {actionError && (
        <p className="text-sm text-status-error" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}
