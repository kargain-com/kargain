"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import {
  buildOnChainAuction,
  buildOnChainHold,
  type OnChainAuction,
  type OnChainHold,
} from "@/lib/auction/parse-on-chain-auction";
import {
  parseChallenge,
  type ChallengeSnapshot,
} from "@/lib/commerce/challenge";
import { commerceModeAddress } from "@/lib/commerce/mode";
import {
  parseAscendingHold,
  type AscendingHoldSnapshot,
} from "@/lib/commerce/parse-ascending";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 30_000;
const CONFIG_STALE_MS = 300_000;

type ContractReadResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type UseAuctionChainReadsArgs = {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
};

/**
 * Batched `AscendingConsignment` reads for one lot: consignment slot,
 * snapshotted auction terms, settlement hold and the BondedChallenge opened
 * against it. Fails closed when the mode is not deployed on this chain.
 */
export function useAuctionChainReads({
  chainId,
  tokenId,
  enabled = true,
}: UseAuctionChainReadsArgs) {
  const mode = commerceModeAddress("ascending", chainId);
  const wc = wagmiChainId(chainId);
  const tokenIdBig = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const readsEnabled = Boolean(enabled && mode && tokenId);

  const perToken = useMemo(
    () =>
      [
        "consignmentPhase",
          "consignmentSellerOf",
          "consignmentAgentOf",
          "consignmentCommissionBpsOf",
          "mandateAsset",
          "consignmentPriceOf",
          "consignmentFloorOf",
          "auctionDuration",
          "consignmentOpenedAt",
          "auctionEndsAt",
          "auctionHighestBidder",
          "auctionHighestBid",
          "auctionMinIncrementBps",
          "auctionExtensionWindow",
          "holdBuyer",
          "holdGross",
          "holdProtectionEndsAt",
          "holdReversalPending",
          "holdAbandonmentDeadline",
          "challengeOpenedAt",
          "challengeBondAmount",
          "challengeWindowDuration",
        "recallRequestTimestamp",
        "isBinding",
        "holdFrozenRemaining",
        "challengeChallenger",
      ] as const,
    [],
  );

  const contracts = useMemo(() => {
    if (!readsEnabled || !mode) return [];
    const perTokenCalls = perToken.map((functionName) => ({
      address: mode,
      abi: AscendingConsignmentAbi,
      functionName,
      args: [tokenIdBig],
      chainId: wc,
    }));
    return [
      ...perTokenCalls,
      {
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "paused",
        args: [],
        chainId: wc,
      },
    ];
  }, [readsEnabled, mode, perToken, tokenIdBig, wc]);

  const { data, isPending, isFetching, refetch } = useReadContracts({
    contracts,
    query: {
      enabled: readsEnabled,
      staleTime: STALE_MS,
      // Snapshotted terms are immutable for the life of the lot; the batch
      // still shares a 30s staleTime for the live bid fields.
      gcTime: CONFIG_STALE_MS,
    },
  });

  const results = data as ReadonlyArray<ContractReadResult> | undefined;

  const value = (index: number): unknown => {
    const entry = results?.[index];
    return entry?.status === "success" ? entry.result : undefined;
  };

  const asBig = (index: number): bigint | undefined => {
    const raw = value(index);
    if (raw == null) return undefined;
    return typeof raw === "bigint" ? raw : BigInt(raw as number);
  };
  const asNum = (index: number): number | undefined => {
    const raw = value(index);
    return raw == null ? undefined : Number(raw);
  };
  const asStr = (index: number): string | undefined => {
    const raw = value(index);
    return typeof raw === "string" ? raw : undefined;
  };

  const auction: OnChainAuction | null = buildOnChainAuction({
    phase: asNum(0),
    seller: asStr(1),
    agent: asStr(2),
    commissionBps: asNum(3),
    asset: asStr(4),
    reserve: asBig(5),
    floor: asBig(6),
    duration: asBig(7),
    openedAt: asBig(8),
    endsAt: asBig(9),
    highestBidder: asStr(10),
    highestBid: asBig(11),
  });

  const hold: OnChainHold | null = buildOnChainHold({
    buyer: asStr(14),
    gross: asBig(15),
    protectionEndsAt: asBig(16),
    reversalPending: value(17) === true,
    abandonmentDeadline: asBig(18),
    challengeOpenedAt: asBig(19),
    challengeBond: asBig(20),
  });

  const holdSnapshot: AscendingHoldSnapshot | null = parseAscendingHold({
    buyer: asStr(14),
    gross: asBig(15),
    protectionEndsAt: asBig(16),
    frozenRemaining: asBig(24),
    reversalPending: value(17) === true,
    abandonmentDeadline: asBig(18),
  });

  const challenge: ChallengeSnapshot | null = parseChallenge(tokenId, {
    challenger: asStr(25),
    bondAmount: asBig(20),
    windowDuration: asBig(21),
    openedAt: asBig(19),
  });

  const commerceReadResolved =
    results?.[0]?.status === "success" && results?.[14]?.status === "success";

  return {
    /** Ascending mode contract; `undefined` disables every write. */
    escrow: mode,
    auction,
    hold,
    /** Settlement hold in commerce shape — drives the settlement panel. */
    holdSnapshot,
    /** BondedChallenge opened against this lot, when any. */
    challenge,
    minIncrementBps: asNum(12),
    extensionWindow: asBig(13),
    paused: value(26) == null ? undefined : value(26) === true,
    /** Recall request timestamp — owner cooldown before `forceRecall`. */
    returnRequestedAt: asBig(22),
    isBinding: value(23) === true,
    settlementDisputeBond: asBig(20),
    settlementHold: asBig(16),
    /** Challenge window in seconds — replaces the escrow dispute timeout. */
    disputeResolutionTimeout: asBig(21),
    commerceReadResolved,
    isPending: readsEnabled && isPending,
    isFetching,
    refetch,
  };
}
