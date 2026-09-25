"use client";

import { useMemo } from "react";

import { parseMandate, type MandateSnapshot } from "@/lib/commerce/mandate";
import {
  commerceModeAbi,
  commerceModeEvmAddress,
  type CommerceMode,
} from "@/lib/commerce/mode";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { eip155WagmiChainId } from "@/lib/web3/supported-chains";

const MANDATE_FUNCTIONS = [
  "mandateActive",
  "mandateAgent",
  "mandateExpiry",
  "mandateAsset",
  "mandateDenominationKind",
  "mandateCurrencyCode",
  "mandateFloor",
  "mandateCompensationForm",
  "mandateCommissionBps",
] as const;

export type UseMandateResult = {
  /** `null` = no mandate; `undefined` = unresolved (fail closed). */
  mandate: MandateSnapshot | null | undefined;
  platformFeeBps: bigint | undefined;
  isPending: boolean;
  refetch: () => void;
};

/** Read one mode's mandate for a token, plus that mode's platform fee. */
export function useMandate(input: {
  mode: CommerceMode;
  chainId: number;
  tokenId: string;
  enabled?: boolean;
}): UseMandateResult {
  const { mode, chainId, tokenId, enabled = true } = input;
  const address = commerceModeEvmAddress(mode, chainId);
  const abi = commerceModeAbi(mode);
  const wc = eip155WagmiChainId(chainId);

  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const contracts = useMemo(() => {
    if (!enabled || !address || wc == null) return [];
    return [
      ...MANDATE_FUNCTIONS.map((functionName) => ({
        key: functionName,
        address,
        abi,
        functionName,
        args: [tid] as const,
        chainId: wc,
      })),
      {
        key: "platformFeeBps" as const,
        address,
        abi,
        functionName: "platformFeeBps",
        args: [] as const,
        chainId: wc,
      },
    ];
  }, [enabled, address, abi, tid, wc]);

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  });

  const activeRead = reads.get("mandateActive");
  const mandate =
    !address || activeRead == null
      ? address
        ? undefined
        : null
      : parseMandate(chainId, mode, tokenId, {
          active: activeRead === true,
          agent: reads.asString("mandateAgent"),
          expiry: reads.asBigint("mandateExpiry"),
          asset: reads.asString("mandateAsset"),
          denominationKind: (() => {
            const v = reads.get("mandateDenominationKind");
            return v == null ? undefined : Number(v);
          })(),
          currencyCode: reads.asString("mandateCurrencyCode"),
          floor: reads.asBigint("mandateFloor"),
          compensationForm: (() => {
            const v = reads.get("mandateCompensationForm");
            return v == null ? undefined : Number(v);
          })(),
          commissionBps: (() => {
            const v = reads.get("mandateCommissionBps");
            return v == null ? undefined : Number(v);
          })(),
        });

  const feeRaw = reads.get("platformFeeBps");

  return {
    mandate,
    platformFeeBps: feeRaw == null ? undefined : BigInt(String(feeRaw)),
    isPending: contracts.length > 0 && reads.isPending,
    refetch: () => {
      void reads.refetch();
    },
  };
}
