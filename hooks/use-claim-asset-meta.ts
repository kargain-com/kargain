"use client";

import { erc20Abi } from "viem";

import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { getViemChain } from "@/lib/web3/supported-chains";

export type ClaimAssetMeta = {
  decimals: number | null;
  symbol: string | null;
  nativeSymbol: string;
};

/** Read ERC-20 decimals/symbol from the asset itself; native uses chain currency. */
export function useClaimAssetMeta(params: {
  chainId: number;
  asset: `0x${string}`;
  isNative: boolean;
}): ClaimAssetMeta {
  const { chainId, asset, isNative } = params;
  const chain = getViemChain(chainId);
  const nativeSymbol = chain?.nativeCurrency.symbol ?? "ETH";

  const reads = useKeyedReadContracts({
    allowFailure: true,
    query: { enabled: !isNative },
    contracts: isNative
      ? []
      : [
          {
            key: "decimals" as const,
            address: asset,
            abi: erc20Abi,
            functionName: "decimals",
            chainId,
          },
          {
            key: "symbol" as const,
            address: asset,
            abi: erc20Abi,
            functionName: "symbol",
            chainId,
          },
        ],
  });

  if (isNative) {
    return {
      decimals: chain?.nativeCurrency.decimals ?? 18,
      symbol: nativeSymbol,
      nativeSymbol,
    };
  }

  const decimalsRaw = reads.get("decimals") ?? null;
  const symbolRaw = reads.get("symbol") ?? null;
  const decimals =
    typeof decimalsRaw === "number"
      ? decimalsRaw
      : typeof decimalsRaw === "bigint"
        ? Number(decimalsRaw)
        : null;

  return {
    decimals: Number.isFinite(decimals) ? decimals : null,
    symbol: typeof symbolRaw === "string" ? symbolRaw : null,
    nativeSymbol,
  };
}
