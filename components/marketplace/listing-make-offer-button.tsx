"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useNostrKey } from "@/hooks/use-nostr-key";
import {
  fetchListingOffers,
  publishListingOffer,
  withdrawListingOffer,
} from "@/lib/nostr/listing-offers";
import { txErrorMessage } from "@/lib/marketplace/tx-error-message";
import { hasListingAgent } from "@/lib/marketplace/listing-agent";

type Props = {
  tokenId: string;
  sellerAddress: `0x${string}`;
  sellerNostrPubkey: string | null;
  agentAddress?: string;
};

export function ListingMakeOfferButton({
  tokenId,
  sellerAddress,
  sellerNostrPubkey,
  agentAddress,
}: Props) {
  const { address, isConnected } = useAccount();
  const { ensureNostrKey } = useNostrKey();
  const [hasActiveOffer, setHasActiveOffer] = useState(false);
  const [checkingOffer, setCheckingOffer] = useState(false);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSeller = Boolean(
    address && address.toLowerCase() === sellerAddress.toLowerCase(),
  );
  const isAgent = Boolean(
    address &&
      hasListingAgent(agentAddress) &&
      address.toLowerCase() === agentAddress!.toLowerCase(),
  );

  useEffect(() => {
    if (!isConnected || !address || !sellerNostrPubkey) {
      setHasActiveOffer(false);
      return;
    }

    let cancelled = false;
    setCheckingOffer(true);

    void (async () => {
      try {
        const offers = await fetchListingOffers(tokenId, sellerNostrPubkey);
        if (cancelled) return;
        const mine = offers.some(
          (o) => o.buyerEthAddress.toLowerCase() === address.toLowerCase(),
        );
        setHasActiveOffer(mine);
      } finally {
        if (!cancelled) setCheckingOffer(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConnected, address, sellerNostrPubkey, tokenId, success]);

  const handleClick = useCallback(async () => {
    if (!address || !sellerNostrPubkey) return;

    setPending(true);
    setError(null);
    setSuccess(false);

    try {
      const privateKey = await ensureNostrKey();
      if (!privateKey) return;

      if (hasActiveOffer) {
        await withdrawListingOffer(tokenId, address, sellerNostrPubkey, privateKey);
        setHasActiveOffer(false);
        setSuccess(true);
      } else {
        await publishListingOffer(tokenId, address, sellerNostrPubkey, privateKey);
        setHasActiveOffer(true);
        setSuccess(true);
      }
    } catch (err) {
      const msg = txErrorMessage(err);
      setError(
        msg && msg !== "Transaction failed."
          ? msg
          : "Failed to publish offer. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }, [
    address,
    ensureNostrKey,
    hasActiveOffer,
    sellerNostrPubkey,
    tokenId,
  ]);

  if (!isConnected || isSeller || isAgent) return null;

  if (!sellerNostrPubkey) {
    return (
      <p className="rounded-md border border-border-default bg-bg-surface p-4 text-sm text-text-secondary">
        Seller has not linked a Nostr identity. Offers are unavailable.
      </p>
    );
  }

  const label = pending
    ? hasActiveOffer
      ? "Withdrawing offer…"
      : "Registering offer…"
    : hasActiveOffer
      ? "Withdraw offer"
      : "Make an offer";

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={pending || checkingOffer}
        onClick={() => void handleClick()}
      >
        {label}
      </Button>
      {success && (
        <p className="text-sm text-text-secondary" role="status">
          {hasActiveOffer ? "Offer registered" : "Offer withdrawn"}
        </p>
      )}
      {error && (
        <p className="text-sm text-accent-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
