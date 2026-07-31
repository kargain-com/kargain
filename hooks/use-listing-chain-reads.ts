"use client";

import { useMemo } from "react";

import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import type { ChainListingRead } from "@/lib/marketplace/effective-listing";
import {
  buildOnChainListing,
  type OnChainListingRow,
} from "@/lib/marketplace/parse-on-chain-listing";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 15_000;

/**
 * Batched `FixedPriceConsignment` reads for one token: consignment slot,
 * recall cooldown timestamp and the seller settlement note. Fails closed when
 * the mode is not deployed on this chain.
 */
export function useListingChainReads(input: {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
}) {
  const { chainId, tokenId, enabled = true } = input;
  const market = commerceModeAddress("fixedPrice", chainId);
  const wc = wagmiChainId(chainId);

  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const readsEnabled = Boolean(enabled && market && tokenId);

  const contracts = useMemo(() => {
    if (!readsEnabled || !market) return [];
    const perToken = (
      [
        "consignmentPhase",
        "consignmentSellerOf",
        "consignmentPriceOf",
        "consignmentDenominationOf",
        "consignmentAgentOf",
        "recallRequestTimestamp",
        "settlementNotes",
      ] as const
    ).map((functionName) => ({
      key: functionName,
      address: market,
      abi: FixedPriceConsignmentAbi,
      functionName,
      args: [tid] as const,
      chainId: wc,
    }));
    return [
      ...perToken,
      {
        key: "paused" as const,
        address: market,
        abi: FixedPriceConsignmentAbi,
        functionName: "paused" as const,
        args: [] as const,
        chainId: wc,
      },
    ];
  }, [readsEnabled, market, tid, wc]);

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: readsEnabled, staleTime: STALE_MS },
  });

  const phaseEntry = reads.entry("consignmentPhase");
  const chainListingRead: ChainListingRead =
    phaseEntry?.status === "success"
      ? "success"
      : phaseEntry?.status === "failure"
        ? "failure"
        : "pending";

  const denomination = reads.get("consignmentDenominationOf") as
    | { currencyCode?: string }
    | readonly [number, string]
    | undefined;
  const currencyCode = Array.isArray(denomination)
    ? denomination[1]
    : (denomination as { currencyCode?: string } | undefined)?.currencyCode;

  const phaseRaw = reads.get("consignmentPhase");
  const listing: OnChainListingRow | null = buildOnChainListing({
    phase: phaseRaw == null ? undefined : Number(phaseRaw),
    seller: reads.asString("consignmentSellerOf"),
    price: reads.asBigint("consignmentPriceOf"),
    currencyCode,
  });

  const agentRaw = reads.get("consignmentAgentOf");
  const pausedRaw = reads.get("paused");

  return {
    /** Fixed-price mode contract; `undefined` disables every write. */
    market,
    listing,
    chainListingRead,
    agent: typeof agentRaw === "string" ? (agentRaw as `0x${string}`) : undefined,
    recallRequestedAt: reads.asBigint("recallRequestTimestamp"),
    settlementNote: decodeSettlementNote(reads.get("settlementNotes")).trim(),
    /** Mode-level G3 pause — chain only; `undefined` while unread/failed. */
    paused: pausedRaw == null ? undefined : pausedRaw === true,
    isLoading: readsEnabled && reads.isLoading,
    refetch: reads.refetch,
  };
}
