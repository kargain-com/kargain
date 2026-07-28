"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { getAuctionDetail } from "@/app/actions/auction-detail";
import {
  deriveAuctionUiState,
  isLiveAuctionUiState,
  type AuctionRow,
  type AuctionUiState,
} from "@/lib/auction/map-ponder-auction";
import {
  deriveSettlementUiState,
  isSettlementPollActive,
} from "@/lib/auction/settlement-state";
import { effectiveReturnRequestedAt } from "@/lib/marketplace/listing-agent";
import { useAuctionChainReads } from "@/hooks/use-auction-chain-reads";
import { useDocumentVisible } from "@/hooks/use-document-visible";
import { useNow } from "@/hooks/use-now";
import type { PassportStatus } from "@/lib/types/ponder";

/** Default settlement dispute resolution timeout (30 days) when chain unread. */
const DEFAULT_DISPUTE_RESOLUTION_TIMEOUT = 30n * 24n * 60n * 60n;

type Args = {
  chainId: number;
  tokenId: string;
  initialAuction?: AuctionRow | null;
  passportStatus: PassportStatus;
  /** Wall-clock tick interval for ENDED derivation + countdown (ms). */
  nowIntervalMs?: number;
  enabled?: boolean;
};

export function useAuctionDetail({
  chainId,
  tokenId,
  initialAuction = null,
  passportStatus,
  nowIntervalMs = 1000,
  enabled = true,
}: Args) {
  const visible = useDocumentVisible();
  const now = useNow(nowIntervalMs);

  const chain = useAuctionChainReads({
    chainId,
    tokenId,
    enabled,
  });

  const ponderQuery = useQuery({
    queryKey: ["auction-detail", chainId, tokenId],
    queryFn: async () => {
      const result = await getAuctionDetail(tokenId);
      if (!result.ok) throw new Error(result.error);
      return result.auction;
    },
    initialData: initialAuction ?? undefined,
    enabled,
    staleTime: 15_000,
    refetchInterval: (q) => {
      const row = q.state.data ?? initialAuction;
      if (!row || !visible) return false;
      const endsAt =
        chain.auction?.endsAt ?? row.endsAt;
      const startedAt =
        chain.auction?.startedAt ?? row.startedAt;
      const active = chain.auction?.active ?? row.active;
      const phase = row.phase;
      const state = deriveAuctionUiState({
        phase,
        active,
        endsAtChain: endsAt,
        startedAt,
        passportStatus:
          (chain.auction ? passportStatus : row.passportStatus) || passportStatus,
        now,
      });
      if (isLiveAuctionUiState(state)) return 15_000;

      // Settlement hold / dispute / refund — poll while non-terminal only.
      if (state === "SETTLED") {
        const settlementState = deriveSettlementUiState({
          settlement: row.settlement,
          hold: chain.hold,
          nowSec: now,
          disputeResolutionTimeoutSec:
            chain.disputeResolutionTimeout ?? DEFAULT_DISPUTE_RESOLUTION_TIMEOUT,
        });
        if (isSettlementPollActive(settlementState)) return 15_000;
      }
      return false;
    },
    refetchIntervalInBackground: false,
  });

  const ponderAuction = ponderQuery.data ?? initialAuction ?? null;

  const merged = useMemo(() => {
    if (!ponderAuction && !chain.auction) {
      return {
        auction: null as AuctionRow | null,
        uiState: "NONE" as AuctionUiState,
      };
    }

    const base = ponderAuction;
    const onChain = chain.auction;

    const phase = base?.phase ?? (onChain?.active ? "BIDDING" : "CREATED");
    const active = onChain?.active ?? base?.active ?? false;
    const endsAtChain = onChain?.endsAt ?? base?.endsAt ?? 0n;
    const startedAt = onChain?.startedAt ?? base?.startedAt ?? 0n;
    const status =
      passportStatus ||
      base?.passportStatus ||
      ("UNVERIFIED" as PassportStatus);

    const uiState = deriveAuctionUiState({
      phase,
      active,
      endsAtChain,
      startedAt,
      passportStatus: status,
      now,
    });

    const mergedReturnAt = (() => {
      const ponderAt = base?.returnRequestedAt ?? 0n;
      const chainAt = chain.returnRequestedAt;
      const effective = effectiveReturnRequestedAt(ponderAt, chainAt);
      return effective > 0n ? effective : null;
    })();

    if (!base && onChain) {
      // Chain-only fallback (indexer lag) — minimal row for commerce mutex
      const synthetic: AuctionRow = {
        chainId,
        tokenId,
        seller: onChain.seller,
        agent:
          onChain.agent === "0x0000000000000000000000000000000000000000"
            ? null
            : onChain.agent,
        asset: onChain.assetNormalized,
        assetLabel: onChain.assetNormalized === "" ? "ETH" : "USDC",
        reserve: onChain.reserve,
        duration: onChain.duration,
        agentFeeBps: onChain.agentFeeBps,
        ownerMinAsset: onChain.ownerMinAsset,
        startedAt: onChain.startedAt,
        endsAt: onChain.endsAt,
        highestBidder:
          onChain.highestBidder === "0x0000000000000000000000000000000000000000"
            ? null
            : onChain.highestBidder,
        highestBid: onChain.highestBid,
        active: onChain.active,
        phase: onChain.startedAt === 0n ? "CREATED" : "BIDDING",
        returnRequestedAt: mergedReturnAt,
        createdAt: 0n,
        updatedAt: 0n,
        passportStatus: status,
        verifier: "",
        title: `Vehicle #${tokenId}`,
        imageUrl: null,
        make: null,
        model: null,
        year: null,
        mileageKm: null,
        duplicateVin: false,
        settlement: null,
      };
      return { auction: synthetic, uiState };
    }

    if (!base) {
      return { auction: null, uiState: "NONE" as AuctionUiState };
    }

    // Chain wins on live amounts / timer / parties when present
    const mergedRow: AuctionRow = {
      ...base,
      seller: onChain?.seller ?? base.seller,
      agent: onChain
        ? onChain.agent === "0x0000000000000000000000000000000000000000"
          ? null
          : onChain.agent
        : base.agent,
      asset: onChain?.assetNormalized ?? base.asset,
      assetLabel: onChain
        ? onChain.assetNormalized === ""
          ? "ETH"
          : "USDC"
        : base.assetLabel,
      reserve: onChain?.reserve ?? base.reserve,
      duration: onChain?.duration ?? base.duration,
      startedAt,
      endsAt: endsAtChain,
      highestBidder: onChain
        ? onChain.highestBidder === "0x0000000000000000000000000000000000000000"
          ? null
          : onChain.highestBidder
        : base.highestBidder,
      highestBid: onChain?.highestBid ?? base.highestBid,
      active,
      passportStatus: status,
      returnRequestedAt: mergedReturnAt,
    };

    return { auction: mergedRow, uiState };
  }, [
    ponderAuction,
    chain.auction,
    chain.returnRequestedAt,
    chainId,
    tokenId,
    passportStatus,
    now,
  ]);

  return {
    auction: merged.auction,
    uiState: merged.uiState,
    now,
    hold: chain.hold,
    minIncrementBps: chain.minIncrementBps ?? 300,
    extensionWindow: chain.extensionWindow ?? 300n,
    paused: chain.paused ?? false,
    settlementDisputeBond: chain.settlementDisputeBond,
    settlementHold: chain.settlementHold,
    disputeResolutionTimeout:
      chain.disputeResolutionTimeout ?? DEFAULT_DISPUTE_RESOLUTION_TIMEOUT,
    escrow: chain.escrow,
    commerceReadResolved: chain.commerceReadResolved,
    chainPending: chain.isPending,
    ponderPending: ponderQuery.isPending,
    ponderError: ponderQuery.error,
    refetch: () => {
      void chain.refetch();
      void ponderQuery.refetch();
    },
  };
}
