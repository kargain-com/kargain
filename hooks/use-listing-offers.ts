"use client";

import { useEffect, useRef, useState } from "react";

import {
  fetchListingOffers,
  type ListingOffer,
} from "@/lib/nostr/listing-offers";

const POLL_INTERVAL_MS = 30_000;

export function useListingOffers(
  tokenId: string | undefined,
  sellerNostrPubkey: string | null,
): { offers: ListingOffer[]; isLoading: boolean } {
  const [offers, setOffers] = useState<ListingOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  const active = Boolean(tokenId?.trim() && sellerNostrPubkey?.trim());

  useEffect(() => {
    if (!active || !tokenId || !sellerNostrPubkey) {
      setOffers([]);
      setIsLoading(false);
      return;
    }

    mountedRef.current = true;

    const load = async (initial: boolean) => {
      if (initial) setIsLoading(true);
      try {
        const result = await fetchListingOffers(tokenId, sellerNostrPubkey);
        if (mountedRef.current) setOffers(result);
      } finally {
        if (mountedRef.current && initial) setIsLoading(false);
      }
    };

    void load(true);
    const interval = window.setInterval(() => {
      void load(false);
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [active, tokenId, sellerNostrPubkey]);

  return { offers, isLoading };
}
