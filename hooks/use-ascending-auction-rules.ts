"use client";

import { useReadContract } from "wagmi";

import { commerceModeEvmAddress } from "@/lib/commerce/mode";
import {
  parseAuctionRules,
  type AuctionRules,
  type AuctionRulesTuple,
} from "@/lib/commerce/parse-ascending";
import { AscendingConsignmentAbi } from "@/lib/contracts/abis.generated";
import { eip155WagmiChainId } from "@/lib/web3/supported-chains";

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
  const mode = commerceModeEvmAddress("ascending", chainId);
  const wc = eip155WagmiChainId(chainId);

  const { data, isPending } = useReadContract({
    address: mode,
    abi: AscendingConsignmentAbi,
    functionName: "auctionRules",
    chainId: wc,
    query: {
      enabled: Boolean(enabled && mode && wc != null),
      staleTime: STALE_MS,
    },
  });

  return {
    rules: parseAuctionRules(data as AuctionRulesTuple | undefined),
    isPending: Boolean(enabled && mode && isPending),
  };
}
