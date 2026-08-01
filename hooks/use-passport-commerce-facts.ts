"use client";

import { useMemo } from "react";

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
import {
  useKeyedReadContracts,
  type KeyedContract,
} from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

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

type ModePrefix = "fp" | "asc";

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
  /**
   * On-chain `custodyLocked(tokenId)` — usable copy not on this chain when true.
   * `undefined` while unread (fail closed for presence).
   */
  custodyLocked: boolean | undefined;
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

  const contracts = useMemo((): KeyedContract[] => {
    if (!enabled || !passport) return [];
    const calls: KeyedContract[] = [
      {
        key: "mayOpen",
        address: passport,
        abi: KarPassportAbi,
        functionName: "may",
        args: [tid, ENCUMBRANCE_INTENT.OpenConsignment],
        chainId: wc,
      },
      {
        key: "mayLeave",
        address: passport,
        abi: KarPassportAbi,
        functionName: "may",
        args: [tid, ENCUMBRANCE_INTENT.LeaveChain],
        chainId: wc,
      },
      {
        key: "challengeOpenedAt",
        address: passport,
        abi: KarPassportAbi,
        functionName: "challengeOpenedAt",
        args: [tid],
        chainId: wc,
      },
      {
        key: "custodyLocked",
        address: passport,
        abi: KarPassportAbi,
        functionName: "custodyLocked",
        args: [tid],
        chainId: wc,
      },
    ];
    if (fixedPrice) {
      calls.push({
        key: "fp.phase",
        address: fixedPrice,
        abi: FixedPriceConsignmentAbi,
        functionName: "consignmentPhase",
        args: [tid],
        chainId: wc,
      });
      for (const functionName of MANDATE_FUNCTIONS) {
        calls.push({
          key: `fp.${functionName}`,
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
        key: "asc.phase",
        address: ascending,
        abi: AscendingConsignmentAbi,
        functionName: "consignmentPhase",
        args: [tid],
        chainId: wc,
      });
      for (const functionName of MANDATE_FUNCTIONS) {
        calls.push({
          key: `asc.${functionName}`,
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

  const reads = useKeyedReadContracts({
    contracts,
    query: { enabled: contracts.length > 0, staleTime: 15_000 },
  });

  const readModeFacts = (
    mode: CommerceMode,
    prefix: ModePrefix,
    configured: boolean,
  ): CommerceModeFacts => {
    if (!configured) {
      return { configured: false, live: false, mandate: null };
    }
    const rawPhase = reads.get(`${prefix}.phase`);
    const phase =
      rawPhase == null ? null : parseConsignmentPhase(Number(rawPhase));
    const activeRead = reads.get(`${prefix}.mandateActive`);
    const mandate =
      activeRead == null
        ? undefined
        : parseMandate(mode, tokenId, {
            active: activeRead === true,
            agent: reads.get(`${prefix}.mandateAgent`) as string | undefined,
            expiry: reads.get(`${prefix}.mandateExpiry`) as bigint | undefined,
            asset: reads.get(`${prefix}.mandateAsset`) as string | undefined,
            denominationKind: (() => {
              const v = reads.get(`${prefix}.mandateDenominationKind`);
              return v == null ? undefined : Number(v);
            })(),
            currencyCode: reads.get(`${prefix}.mandateCurrencyCode`) as
              | string
              | undefined,
            floor: reads.get(`${prefix}.mandateFloor`) as bigint | undefined,
            compensationForm: (() => {
              const v = reads.get(`${prefix}.mandateCompensationForm`);
              return v == null ? undefined : Number(v);
            })(),
            commissionBps: (() => {
              const v = reads.get(`${prefix}.mandateCommissionBps`);
              return v == null ? undefined : Number(v);
            })(),
          });
    return {
      configured: true,
      live: rawPhase == null ? undefined : isLiveConsignmentPhase(phase),
      mandate: mandate === undefined ? undefined : mandate,
    };
  };

  const fixedPriceFacts = readModeFacts(
    "fixedPrice",
    "fp",
    Boolean(fixedPrice),
  );
  const ascendingFacts = readModeFacts("ascending", "asc", Boolean(ascending));

  const mayOpen = reads.get("mayOpen");
  const mayLeave = reads.get("mayLeave");
  const challengeOpenedAt = reads.get("challengeOpenedAt");
  const custodyLockedRaw = reads.get("custodyLocked");

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
    custodyLocked:
      custodyLockedRaw == null ? undefined : custodyLockedRaw === true,
    challengeOpen:
      challengeOpenedAt == null
        ? undefined
        : BigInt(String(challengeOpenedAt)) > 0n,
    liveConsignmentMode,
    hasLiveConsignment,
    isPending: contracts.length > 0 && reads.isPending,
    refetch: () => {
      void reads.refetch();
    },
  };
}

export { CONSIGNMENT_PHASE };
