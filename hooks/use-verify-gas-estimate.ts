"use client";

import { useQuery } from "@tanstack/react-query";
import { estimateFeesPerGas } from "viem/actions";

import { getPublicClient } from "@/lib/web3/public-client";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";
import {
  VERIFY_PASSPORT_GAS_UNITS,
  verifyGasCostWei,
} from "@/lib/verifier/verify-gas-estimate";

type UseVerifyGasEstimateOptions = {
  enabled?: boolean;
};

export function useVerifyGasEstimate(options?: UseVerifyGasEstimateOptions) {
  const enabled = options?.enabled ?? true;
  const chainId = DEFAULT_CHAIN_ID;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["verify-gas-estimate", chainId],
    queryFn: async () => {
      const client = getPublicClient(chainId);
      const fees = await estimateFeesPerGas(client);
      const maxFee = fees.maxFeePerGas ?? fees.gasPrice;
      if (maxFee == null || maxFee <= 0n) return null;
      return verifyGasCostWei(VERIFY_PASSPORT_GAS_UNITS, maxFee);
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  return {
    costWei: data ?? null,
    isLoading: enabled && (isLoading || isFetching),
    refetch,
  };
}
