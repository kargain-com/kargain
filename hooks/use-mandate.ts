"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { parseMandate, type MandateSnapshot } from "@/lib/commerce/mandate";
import {
  commerceModeAbi,
  commerceModeAddress,
  type CommerceMode,
} from "@/lib/commerce/mode";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type ReadResult =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

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
  const address = commerceModeAddress(mode, chainId);
  const abi = commerceModeAbi(mode);
  const wc = wagmiChainId(chainId);

  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const contracts = useMemo(() => {
    if (!enabled || !address) return [];
    return [
      ...MANDATE_FUNCTIONS.map((functionName) => ({
        address,
        abi,
        functionName,
        args: [tid] as readonly unknown[],
        chainId: wc,
      })),
      {
        address,
        abi,
        functionName: "platformFeeBps",
        args: [] as readonly unknown[],
        chainId: wc,
      },
    ];
  }, [enabled, address, abi, tid, wc]);

  const { data, isPending, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  });

  const results = data as ReadonlyArray<ReadResult> | undefined;
  const at = (index: number): unknown => {
    const entry = results?.[index];
    return entry?.status === "success" ? entry.result : undefined;
  };

  const activeRead = at(0);
  const mandate =
    !address || activeRead == null
      ? address
        ? undefined
        : null
      : parseMandate(mode, tokenId, {
          active: activeRead === true,
          agent: at(1) as string | undefined,
          expiry: at(2) as bigint | undefined,
          asset: at(3) as string | undefined,
          denominationKind: at(4) == null ? undefined : Number(at(4)),
          currencyCode: at(5) as string | undefined,
          floor: at(6) as bigint | undefined,
          compensationForm: at(7) == null ? undefined : Number(at(7)),
          commissionBps: at(8) == null ? undefined : Number(at(8)),
        });

  const feeRaw = at(9);

  return {
    mandate,
    platformFeeBps: feeRaw == null ? undefined : BigInt(String(feeRaw)),
    isPending: contracts.length > 0 && isPending,
    refetch: () => {
      void refetch();
    },
  };
}
