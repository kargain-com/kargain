"use client";

import { useReadContract } from "wagmi";

import { commerceModeAddress } from "@/lib/commerce/mode";
import {
  parseAuctionRules,
  type AuctionRules,
  type AuctionRulesTuple,
} from "@/lib/commerce/parse-ascending";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const STALE_MS = 300_000;

/**
 * Mode-level Ascending `auctionRules()` — duration/protection bounds,
 * extension, abandonment, increment, and challenge bond.
 */
export function useAscendingAuctionRules(args: {
  chainId: number;
  enabled?: boolean;
}): {
  rules: AuctionRules | null;
  isPending: boolean;
} {
  const { chainId, enabled = true } = args;
  const mode = commerceModeAddress("ascending", chainId);

  const { data, isPending } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "auctionRules",
    chainId: wagmiChainId(chainId),
    query: {
      enabled: Boolean(enabled && mode),
      staleTime: STALE_MS,
    },
  });

  return {
    rules: parseAuctionRules(data as AuctionRulesTuple | undefined),
    isPending: Boolean(enabled && mode && isPending),
  };
}
