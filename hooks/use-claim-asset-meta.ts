"use client";

import { erc20Abi } from "viem";
import { useReadContracts } from "wagmi";

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

  const { data } = useReadContracts({
    allowFailure: true,
    query: { enabled: !isNative },
    contracts: [
      {
        address: asset,
        abi: erc20Abi,
        functionName: "decimals",
        chainId,
      },
      {
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

  const decimalsRaw = data?.[0]?.status === "success" ? data[0].result : null;
  const symbolRaw = data?.[1]?.status === "success" ? data[1].result : null;
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
