"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import {
  chainlinkEurUsdFeed,
  chainlinkNativeUsdFeed,
} from "@/lib/web3/deployment-addresses";
import { fxRateChainId } from "@/lib/web3/chain-context";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

function isValidFeedAddress(address: `0x${string}` | undefined): address is `0x${string}` {
  return Boolean(address && address.toLowerCase() !== ZERO_ADDRESS);
}

function parseAnswer(result: unknown): bigint | null {
  if (!Array.isArray(result) || result.length < 2) return null;
  const answer = result[1];
  if (typeof answer !== "bigint" || answer <= 0n) return null;
  return answer;
}

export function useChainlinkRates(options?: { enabled?: boolean }): {
  ethUsd: bigint | null;
  eurUsd: bigint | null;
  isLoading: boolean;
} {
  const enabled = options?.enabled ?? true;
  // Always read feeds on the FX reference pin — not the wallet's active chain.
  const fxChain = fxRateChainId();
  const chainId = wagmiChainId(fxChain);
  const nativeFeed = chainlinkNativeUsdFeed(fxChain);
  const eurFeed = chainlinkEurUsdFeed(fxChain);

  const contracts = useMemo(() => {
    const reads: Array<{
      address: `0x${string}`;
      abi: typeof AGGREGATOR_V3_ABI;
      functionName: "latestRoundData";
      chainId: typeof chainId;
    }> = [];

    if (isValidFeedAddress(nativeFeed)) {
      reads.push({
        address: nativeFeed,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
        chainId,
      });
    }
    if (isValidFeedAddress(eurFeed)) {
      reads.push({
        address: eurFeed,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
        chainId,
      });
    }

    return reads;
  }, [chainId, nativeFeed, eurFeed]);

  const hasNative = isValidFeedAddress(nativeFeed);
  const hasEur = isValidFeedAddress(eurFeed);

  const { data, isLoading } = useReadContracts({
    contracts,
    query: {
      enabled: enabled && contracts.length > 0,
      staleTime: 60_000,
    },
  });

  let ethUsd: bigint | null = null;
  let eurUsd: bigint | null = null;

  if (data) {
    let index = 0;
    if (hasNative) {
      const read = data[index];
      if (read?.status === "success") {
        ethUsd = parseAnswer(read.result);
      }
      index += 1;
    }
    if (hasEur) {
      const read = data[index];
      if (read?.status === "success") {
        eurUsd = parseAnswer(read.result);
      }
    }
  }

  return { ethUsd, eurUsd, isLoading: enabled && contracts.length > 0 && isLoading };
}
