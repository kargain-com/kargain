"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import {
  CONSIGNMENT_PHASE,
  ENCUMBRANCE_INTENT,
  isLiveConsignmentPhase,
  parseConsignmentPhase,
} from "@/lib/commerce/consignment";
import { parseMandate, type MandateSnapshot } from "@/lib/commerce/mandate";
import { commerceModeAddress, type CommerceMode } from "@/lib/commerce/mode";
import {
  AscendingConsignmentAbi,
  FixedPriceConsignmentAbi,
  KarPassportAbi,
} from "@/lib/contracts/abis.generated";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
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

export type CommerceModeFacts = {
  /** `false` when the mode is not deployed on this chain. */
  configured: boolean;
  /** `undefined` while the phase read is unresolved. */
  live: boolean | undefined;
  /** `undefined` while the mandate reads are unresolved. */
  mandate: MandateSnapshot | null | undefined;
};

export type PassportCommerceFacts = {
  fixedPrice: CommerceModeFacts;
  ascending: CommerceModeFacts;
  /** `may(tokenId, OpenConsignment)`; `undefined` fails closed. */
  mayOpenConsignment: boolean | undefined;
  /** `may(tokenId, LeaveChain)`; `undefined` fails closed. */
  mayLeaveChain: boolean | undefined;
  /** Bonded verification challenge open on the passport itself. */
  challengeOpen: boolean | undefined;
  /** Mode holding a live consignment, when exactly one does. */
  liveConsignmentMode: CommerceMode | null;
  /** `undefined` until every mode phase read resolves. */
  hasLiveConsignment: boolean | undefined;
  isPending: boolean;
  refetch: () => void;
};

/**
 * One batched read of every commerce fact the passport surfaces need:
 * `may` intents, per-mode consignment phase, and per-mode mandate.
 * Missing mode addresses fail closed (not configured, never "free").
 */
export function usePassportCommerceFacts(input: {
  chainId: number;
  tokenId: string;
  enabled?: boolean;
}): PassportCommerceFacts {
  const { chainId, tokenId, enabled = true } = input;
  const passport = karPassportAddress(chainId);
  const fixedPrice = commerceModeAddress("fixedPrice", chainId);
  const ascending = commerceModeAddress("ascending", chainId);
  const wc = wagmiChainId(chainId);

  const tid = useMemo(() => {
    try {
      return BigInt(tokenId);
    } catch {
      return 0n;
    }
  }, [tokenId]);

  const contracts = useMemo(() => {
    if (!enabled || !passport) return [];
    const calls: {
      address: `0x${string}`;
      abi: typeof KarPassportAbi | typeof FixedPriceConsignmentAbi | typeof AscendingConsignmentAbi;
      functionName: string;
      args: readonly unknown[];
      chainId: number;
    }[] = [
      {
        address: passport,
        abi: KarPassportAbi,
        functionName: "may",
        args: [tid, ENCUMBRANCE_INTENT.OpenConsignment],
        chainId: wc,
      },
      {
        address: passport,
        abi: KarPassportAbi,
        functionName: "may",
        args: [tid, ENCUMBRANCE_INTENT.LeaveChain],
        chainId: wc,
      },
      {
        address: passport,
        abi: KarPassportAbi,
        functionName: "challengeOpenedAt",
        args: [tid],
        chainId: wc,
      },
    ];
    if (fixedPrice) {
      calls.push({
        address: fixedPrice,
        abi: FixedPriceConsignmentAbi,
        functionName: "consignmentPhase",
        args: [tid],
        chainId: wc,
      });
      for (const functionName of MANDATE_FUNCTIONS) {
        calls.push({
          address: fixedPrice,
          abi: FixedPriceConsignmentAbi,
          functionName,
          args: [tid],
          chainId: wc,
        });
      }
    }
    if (ascending) {
      calls.push({
        address: ascending,
        abi: AscendingConsignmentAbi,
        functionName: "consignmentPhase",
        args: [tid],
        chainId: wc,
      });
      for (const functionName of MANDATE_FUNCTIONS) {
        calls.push({
          address: ascending,
          abi: AscendingConsignmentAbi,
          functionName,
          args: [tid],
          chainId: wc,
        });
      }
    }
    return calls;
  }, [enabled, passport, fixedPrice, ascending, tid, wc]);

  const { data, isPending, refetch } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  });

  const results = data as ReadonlyArray<ReadResult> | undefined;
  const at = (index: number): unknown => {
    const entry = results?.[index];
    return entry?.status === "success" ? entry.result : undefined;
  };

  const fixedPriceBase = fixedPrice ? 3 : -1;
  const ascendingBase = ascending ? (fixedPrice ? 13 : 3) : -1;

  const readModeFacts = (
    mode: CommerceMode,
    base: number,
    configured: boolean,
  ): CommerceModeFacts => {
    if (!configured || base < 0) {
      return { configured: false, live: false, mandate: null };
    }
    const rawPhase = at(base);
    const phase =
      rawPhase == null ? null : parseConsignmentPhase(Number(rawPhase));
    const activeRead = at(base + 1);
    const mandate =
      activeRead == null
        ? undefined
        : parseMandate(mode, tokenId, {
            active: activeRead === true,
            agent: at(base + 2) as string | undefined,
            expiry: at(base + 3) as bigint | undefined,
            asset: at(base + 4) as string | undefined,
            denominationKind:
              at(base + 5) == null ? undefined : Number(at(base + 5)),
            currencyCode: at(base + 6) as string | undefined,
            floor: at(base + 7) as bigint | undefined,
            compensationForm:
              at(base + 8) == null ? undefined : Number(at(base + 8)),
            commissionBps:
              at(base + 9) == null ? undefined : Number(at(base + 9)),
          });
    return {
      configured: true,
      live: rawPhase == null ? undefined : isLiveConsignmentPhase(phase),
      mandate: mandate === undefined ? undefined : mandate,
    };
  };

  const fixedPriceFacts = readModeFacts("fixedPrice", fixedPriceBase, Boolean(fixedPrice));
  const ascendingFacts = readModeFacts("ascending", ascendingBase, Boolean(ascending));

  const mayOpen = at(0);
  const mayLeave = at(1);
  const challengeOpenedAt = at(2);

  const anyUnresolved =
    fixedPriceFacts.live === undefined || ascendingFacts.live === undefined;
  const hasLiveConsignment = anyUnresolved
    ? undefined
    : Boolean(fixedPriceFacts.live) || Boolean(ascendingFacts.live);

  const liveConsignmentMode: CommerceMode | null = fixedPriceFacts.live
    ? "fixedPrice"
    : ascendingFacts.live
      ? "ascending"
      : null;

  return {
    fixedPrice: fixedPriceFacts,
    ascending: ascendingFacts,
    mayOpenConsignment: mayOpen == null ? undefined : mayOpen === true,
    mayLeaveChain: mayLeave == null ? undefined : mayLeave === true,
    challengeOpen:
      challengeOpenedAt == null ? undefined : BigInt(String(challengeOpenedAt)) > 0n,
    liveConsignmentMode,
    hasLiveConsignment,
    isPending: contracts.length > 0 && isPending,
    refetch: () => {
      void refetch();
    },
  };
}

export { CONSIGNMENT_PHASE };
