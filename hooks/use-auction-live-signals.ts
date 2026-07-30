"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  detectEndsAtExtension,
  detectOutbidTransition,
  formatExtensionFlash,
  formatOutbidToastMessage,
  hasOutbidBeenNotified,
  markOutbidNotified,
  outbidSessionKey,
} from "@/lib/auction/auction-live-signals";
import { formatAuctionAmount } from "@/lib/auction/format-auction";
import type { AuctionUiState } from "@/lib/auction/map-ponder-auction";

const FLASH_CLEAR_MS = 7_000;

type Args = {
  chainId: number;
  tokenId: string;
  /** Merged chain/Ponder endsAt — updates on existing refetch only. */
  endsAt: bigint;
  startedAt: bigint;
  highestBidder: string | null;
  highestBid: bigint;
  assetLabel: "ETH" | "USDC";
  uiState: AuctionUiState;
  wallet: string | undefined;
  extensionWindow: bigint;
  /** Only detect while live bidding (S3) or when endsAt can extend. */
  enabled?: boolean;
};

/**
 * Extension flash + outbid toast derived from auction detail refetch values.
 * Zero new intervals — compare previous vs next on prop change only.
 */
export function useAuctionLiveSignals({
  chainId,
  tokenId,
  endsAt,
  startedAt,
  highestBidder,
  highestBid,
  assetLabel,
  uiState,
  wallet,
  extensionWindow,
  enabled = true,
}: Args) {
  const [extensionFlash, setExtensionFlash] = useState<string | null>(null);
  const [outbidToast, setOutbidToast] = useState<string | null>(null);

  const prevEndsAtRef = useRef<bigint | null>(null);
  const prevHighestBidderRef = useRef<string | null | undefined>(undefined);
  const prevHighestBidRef = useRef<bigint | null | undefined>(undefined);
  const hydratedRef = useRef(false);

  const clearOutbidToast = useCallback(() => setOutbidToast(null), []);

  useEffect(() => {
    if (!enabled) {
      prevEndsAtRef.current = endsAt > 0n ? endsAt : null;
      prevHighestBidderRef.current = highestBidder;
      prevHighestBidRef.current = highestBid;
      hydratedRef.current = true;
      return;
    }

    // Seed previous values on first observation — never flash/toast on mount.
    if (!hydratedRef.current) {
      prevEndsAtRef.current = endsAt > 0n ? endsAt : null;
      prevHighestBidderRef.current = highestBidder;
      prevHighestBidRef.current = highestBid;
      hydratedRef.current = true;
      return;
    }

    const liveForExtension = uiState === "S3" || uiState === "S4";
    if (
      liveForExtension &&
      detectEndsAtExtension(prevEndsAtRef.current, endsAt)
    ) {
      const flash = formatExtensionFlash(extensionWindow);
      if (flash != null) setExtensionFlash(flash);
    }
    prevEndsAtRef.current = endsAt > 0n ? endsAt : prevEndsAtRef.current;

    const lostBid = detectOutbidTransition({
      wallet,
      prevHighestBidder: prevHighestBidderRef.current,
      prevHighestBid: prevHighestBidRef.current,
      nextHighestBidder: highestBidder,
    });
    if (lostBid != null && startedAt > 0n) {
      const key = outbidSessionKey({
        chainId,
        tokenId,
        startedAt,
        lostBid,
      });
      if (!hasOutbidBeenNotified(key)) {
        markOutbidNotified(key);
        setOutbidToast(
          formatOutbidToastMessage(formatAuctionAmount(lostBid, assetLabel)),
        );
      }
    }
    prevHighestBidderRef.current = highestBidder;
    prevHighestBidRef.current = highestBid;
  }, [
    enabled,
    endsAt,
    startedAt,
    highestBidder,
    highestBid,
    assetLabel,
    uiState,
    wallet,
    extensionWindow,
    chainId,
    tokenId,
  ]);

  useEffect(() => {
    if (!extensionFlash) return;
    const id = window.setTimeout(() => setExtensionFlash(null), FLASH_CLEAR_MS);
    return () => window.clearTimeout(id);
  }, [extensionFlash]);

  return {
    extensionFlash,
    outbidToast,
    clearOutbidToast,
  };
}
