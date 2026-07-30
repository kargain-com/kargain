"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { commerceModeAddress } from "@/lib/commerce/mode";
import { FixedPriceConsignmentAbi } from "@/lib/contracts/abis.generated";
import type { ChainListingRead } from "@/lib/marketplace/effective-listing";
import {
  buildOnChainListing,
  type OnChainListingRow,
} from "@/lib/marketplace/parse-on-chain-listing";
import { decodeSettlementNote } from "@/lib/marketplace/settlement-note";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 15_000;

type ContractReadResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

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
      address: market,
      abi: FixedPriceConsignmentAbi,
      functionName,
      args: [tid] as readonly unknown[],
      chainId: wc,
    }));
    return [
      ...perToken,
      {
        address: market,
        abi: FixedPriceConsignmentAbi,
        functionName: "paused" as const,
        args: [] as const,
        chainId: wc,
      },
    ];
  }, [readsEnabled, market, tid, wc]);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: readsEnabled, staleTime: STALE_MS },
  });

  const results = data as ReadonlyArray<ContractReadResult> | undefined;
  const value = (index: number): unknown => {
    const entry = results?.[index];
    return entry?.status === "success" ? entry.result : undefined;
  };

  const phaseRead = results?.[0];
  const chainListingRead: ChainListingRead =
    phaseRead?.status === "success"
      ? "success"
      : phaseRead?.status === "failure"
        ? "failure"
        : "pending";

  const denomination = value(3) as
    | { currencyCode?: string }
    | readonly [number, string]
    | undefined;
  const currencyCode = Array.isArray(denomination)
    ? denomination[1]
    : (denomination as { currencyCode?: string } | undefined)?.currencyCode;

  const listing: OnChainListingRow | null = buildOnChainListing({
    phase: value(0) == null ? undefined : Number(value(0)),
    seller: value(1) as string | undefined,
    price: value(2) as bigint | undefined,
    currencyCode,
  });

  const agentRaw = value(4);

  return {
    /** Fixed-price mode contract; `undefined` disables every write. */
    market,
    listing,
    chainListingRead,
    agent: typeof agentRaw === "string" ? (agentRaw as `0x${string}`) : undefined,
    recallRequestedAt: value(5) as bigint | undefined,
    settlementNote: decodeSettlementNote(value(6)).trim(),
    /** Mode-level G3 pause — chain only; `undefined` while unread/failed. */
    paused: value(7) == null ? undefined : value(7) === true,
    isLoading: readsEnabled && isLoading,
    refetch,
  };
}
