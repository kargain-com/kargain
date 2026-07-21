"use client";

import { useQuery } from "@tanstack/react-query";
import { estimateFeesPerGas } from "viem/actions";

import { getPublicClient } from "@/lib/web3/public-client";
import {
  VERIFY_PASSPORT_GAS_UNITS,
  verifyGasCostWei,
  verifyGasEstimateQueryKey,
} from "@/lib/verifier/verify-gas-estimate";

type UseVerifyGasEstimateOptions = {
  chainId: number;
  enabled?: boolean;
};

export function useVerifyGasEstimate(options: UseVerifyGasEstimateOptions) {
  const { chainId, enabled = true } = options;

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: verifyGasEstimateQueryKey(chainId),
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
