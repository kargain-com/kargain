"use client";

import { useMemo } from "react";

import {
  buildOnChainAuction,
  buildOnChainHold,
  type OnChainAuction,
  type OnChainHold,
} from "@/lib/auction/parse-on-chain-auction";
import {
  parseChallenge,
  type ChallengeSnapshot,
} from "@/lib/challenge";
import { commerceModeAddress } from "@/lib/commerce/mode";
import {
  parseAscendingHold,
  type AscendingHoldSnapshot,
} from "@/lib/commerce/parse-ascending";
import {
  AscendingConsignmentAbi,
  KarPassportAbi,
} from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 30_000;
const CONFIG_STALE_MS = 300_000;

const PER_TOKEN = [
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
  "auctionProtectionWindow",
] as const;

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
  const passport = karPassportAddress(chainId);
  const wc = wagmiChainId(chainId);
  const tokenIdBig = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const readsEnabled = Boolean(enabled && mode && tokenId);

  const contracts = useMemo(() => {
    if (!readsEnabled || !mode) return [];
    const modeReads = [
      ...PER_TOKEN.map((functionName) => ({
        key: functionName,
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName,
        args: [tokenIdBig] as const,
        chainId: wc,
      })),
      {
        key: "paused" as const,
        address: mode,
        abi: AscendingConsignmentAbi,
        functionName: "paused",
        args: [] as const,
        chainId: wc,
      },
    ];
    if (!passport) return modeReads;
    return [
      ...modeReads,
      {
        key: "passportOwnerOf" as const,
        address: passport,
        abi: KarPassportAbi,
        functionName: "ownerOf",
        args: [tokenIdBig] as const,
        chainId: wc,
      },
    ];
  }, [readsEnabled, mode, passport, tokenIdBig, wc]);

  const reads = useKeyedReadContracts({
    contracts,
    query: {
      enabled: readsEnabled,
      staleTime: STALE_MS,
      // Snapshotted terms are immutable for the life of the lot; the batch
      // still shares a 30s staleTime for the live bid fields.
      gcTime: CONFIG_STALE_MS,
    },
  });

  const auction: OnChainAuction | null = buildOnChainAuction({
    phase: reads.asNumber("consignmentPhase"),
    seller: reads.asString("consignmentSellerOf"),
    agent: reads.asString("consignmentAgentOf"),
    commissionBps: reads.asNumber("consignmentCommissionBpsOf"),
    asset: reads.asString("mandateAsset"),
    reserve: reads.asBigint("consignmentPriceOf"),
    floor: reads.asBigint("consignmentFloorOf"),
    duration: reads.asBigint("auctionDuration"),
    openedAt: reads.asBigint("consignmentOpenedAt"),
    endsAt: reads.asBigint("auctionEndsAt"),
    highestBidder: reads.asString("auctionHighestBidder"),
    highestBid: reads.asBigint("auctionHighestBid"),
  });

  const hold: OnChainHold | null = buildOnChainHold({
    buyer: reads.asString("holdBuyer"),
    gross: reads.asBigint("holdGross"),
    protectionEndsAt: reads.asBigint("holdProtectionEndsAt"),
    reversalPending: reads.get("holdReversalPending") === true,
    abandonmentDeadline: reads.asBigint("holdAbandonmentDeadline"),
    challengeOpenedAt: reads.asBigint("challengeOpenedAt"),
    challengeBond: reads.asBigint("challengeBondAmount"),
  });

  const holdSnapshot: AscendingHoldSnapshot | null = parseAscendingHold({
    buyer: reads.asString("holdBuyer"),
    gross: reads.asBigint("holdGross"),
    protectionEndsAt: reads.asBigint("holdProtectionEndsAt"),
    frozenRemaining: reads.asBigint("holdFrozenRemaining"),
    reversalPending: reads.get("holdReversalPending") === true,
    abandonmentDeadline: reads.asBigint("holdAbandonmentDeadline"),
  });

  const challenge: ChallengeSnapshot | null = parseChallenge(tokenId, {
    challenger: reads.asString("challengeChallenger"),
    bondAmount: reads.asBigint("challengeBondAmount"),
    windowDuration: reads.asBigint("challengeWindowDuration"),
    openedAt: reads.asBigint("challengeOpenedAt"),
  });

  const commerceReadResolved =
    reads.entry("consignmentPhase")?.status === "success" &&
    reads.entry("holdBuyer")?.status === "success";

  const pausedRaw = reads.get("paused");

  const passportOwnerEntry = reads.entry("passportOwnerOf");
  /** Current NFT holder; `undefined` unread, `null` failed/missing. */
  const passportTokenOwner: string | null | undefined =
    !passport || !readsEnabled
      ? undefined
      : passportOwnerEntry == null
        ? undefined
        : passportOwnerEntry.status === "success" &&
            typeof passportOwnerEntry.result === "string"
          ? passportOwnerEntry.result
          : null;

  return {
    /** Ascending mode contract; `undefined` disables every write. */
    escrow: mode,
    auction,
    hold,
    /** Settlement hold in commerce shape — drives the settlement panel. */
    holdSnapshot,
    /** BondedChallenge opened against this lot, when any. */
    challenge,
    /** Live `ownerOf` on the passport for this token (reversal holder check). */
    passportTokenOwner,
    minIncrementBps: reads.asNumber("auctionMinIncrementBps"),
    extensionWindow: reads.asBigint("auctionExtensionWindow"),
    /** Lot snapshotted protection length (seconds) — not live mode bounds. */
    protectionWindow: reads.asBigint("auctionProtectionWindow"),
    paused: pausedRaw == null ? undefined : pausedRaw === true,
    /** Recall request timestamp — owner cooldown before `forceRecall`. */
    returnRequestedAt: reads.asBigint("recallRequestTimestamp"),
    isBinding: reads.get("isBinding") === true,
    settlementDisputeBond: reads.asBigint("challengeBondAmount"),
    settlementHold: reads.asBigint("holdProtectionEndsAt"),
    /** Challenge window in seconds — replaces the escrow dispute timeout. */
    disputeResolutionTimeout: reads.asBigint("challengeWindowDuration"),
    commerceReadResolved,
    isPending: readsEnabled && reads.isPending,
    isFetching: reads.isFetching,
    refetch: reads.refetch,
  };
}
