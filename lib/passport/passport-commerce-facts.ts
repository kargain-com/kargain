/**
 * Sole dual-VM owner of passport commerce chrome reads (U9.2a / S8-D1a).
 *
 * EVM: batched may / custodyLocked (ABI key) / encumbrance / mode phase+mandate.
 * SVM: PassportState keyed-read → custodyLock fact only; other facts stay unread /
 * not configured (never invent false / unlocked).
 *
 * wagmiChainId is reachable only on the EVM arm of {@link planPassportCommerceReads}.
 */

import {
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
import {
  deriveEncumbrancePermission,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import {
  deriveEncumbranceRegistry,
  MAX_ENCUMBRANCE_SOURCES,
  type EncumbranceRegistry,
} from "@/lib/passport/encumbrance-registry";
import {
  type CustodyLockRead,
} from "@/lib/passport/presence";
import { decodePassportState } from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import {
  commercialActive,
  type CommercialRegistry,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import type {
  KeyedContract,
  KeyedEntry,
} from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export const PASSPORT_STATE_KEY = "passportState" as const;

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
  /** `may(tokenId, OpenConsignment)` — available | blocked with named cause. */
  openConsignmentPermission: EncumbrancePermissionGate;
  /** `may(tokenId, LeaveChain)` — available | blocked with named cause. */
  leaveChainPermission: EncumbrancePermissionGate;
  /**
   * On-chain encumbrance registry membership for this custody-chain passport
   * contract (not token-scoped).
   */
  encumbranceRegistry: EncumbranceRegistry;
  /**
   * On-chain custody lock as a fact — known | pending | refused(cause).
   * Never invent unlocked from absence.
   */
  custodyLock: CustodyLockRead;
  /** Bonded verification challenge open on the passport itself. */
  challengeOpen: boolean | undefined;
  /** Mode holding a live consignment, when exactly one does. */
  liveConsignmentMode: CommerceMode | null;
  /** `undefined` until every mode phase read resolves. */
  hasLiveConsignment: boolean | undefined;
  isPending: boolean;
};

export type PassportCommerceReadPlan =
  | {
      ok: true;
      vm: "evm";
      contracts: readonly KeyedContract[];
      tokenId: string;
      fixedPriceConfigured: boolean;
      ascendingConfigured: boolean;
    }
  | {
      ok: true;
      vm: "svm";
      contracts: readonly KeyedContract<typeof PASSPORT_STATE_KEY>[];
      tokenId: string;
    }
  | {
      ok: true;
      vm: null;
      contracts: readonly [];
      tokenId: string;
    }
  | {
      ok: false;
      cause: "pda_failed" | "invalid_token_id";
      detail: string;
    };

function buildEvmContracts(args: {
  passport: `0x${string}`;
  fixedPrice: `0x${string}` | undefined;
  ascending: `0x${string}` | undefined;
  tid: bigint;
  wc: number;
}): KeyedContract[] {
  const { passport, fixedPrice, ascending, tid, wc } = args;
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
    {
      key: "encumbranceSourceCount",
      address: passport,
      abi: KarPassportAbi,
      functionName: "encumbranceSourceCount",
      chainId: wc,
    },
  ];
  for (let i = 0; i < MAX_ENCUMBRANCE_SOURCES; i++) {
    calls.push({
      key: `encumbranceSourceAt.${i}`,
      address: passport,
      abi: KarPassportAbi,
      functionName: "encumbranceSourceAt",
      args: [BigInt(i)],
      chainId: wc,
    });
  }
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
}

/**
 * Plan keyed reads for commerce chrome. EVM builds the full batch; SVM builds
 * a single PassportState account read. Unregistered → empty (honest unread).
 */
export async function planPassportCommerceReads(args: {
  chainId: number;
  tokenId: string;
  registry?: CommercialRegistry;
}): Promise<PassportCommerceReadPlan> {
  const stack = commercialActive(args.chainId, args.registry);
  if (stack == null) {
    return { ok: true, vm: null, contracts: [], tokenId: args.tokenId };
  }

  if (stack.vm === "evm") {
    const passport = karPassportAddress(args.chainId);
    if (passport == null) {
      return { ok: true, vm: null, contracts: [], tokenId: args.tokenId };
    }
    let tid: bigint;
    try {
      tid = BigInt(args.tokenId);
    } catch {
      return {
        ok: false,
        cause: "invalid_token_id",
        detail: args.tokenId,
      };
    }
    const fixedPrice = commerceModeAddress("fixedPrice", args.chainId);
    const ascending = commerceModeAddress("ascending", args.chainId);
    const wc = wagmiChainId(args.chainId);
    return {
      ok: true,
      vm: "evm",
      tokenId: args.tokenId,
      fixedPriceConfigured: Boolean(fixedPrice),
      ascendingConfigured: Boolean(ascending),
      contracts: buildEvmContracts({
        passport,
        fixedPrice,
        ascending,
        tid,
        wc,
      }),
    };
  }

  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(args.tokenId);
  } catch (err) {
    return {
      ok: false,
      cause: "invalid_token_id",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const statePda = await deriveSvmPda({
    recipe: "kar-passport/state",
    programId: stack.karPassport,
    seeds: { token_id: tokenBytes },
  });
  if (!statePda.ok) {
    return {
      ok: false,
      cause: "pda_failed",
      detail: `${statePda.cause}:${statePda.detail}`,
    };
  }

  return {
    ok: true,
    vm: "svm",
    tokenId: args.tokenId,
    contracts: [
      {
        key: PASSPORT_STATE_KEY,
        vm: "svm",
        account: statePda.address,
      },
    ],
  };
}

/**
 * Dispute-window + challengeOpenedAt batch for the actions panel.
 * EVM-only; SVM / missing passport → empty (no wagmiChainId).
 */
export function planPassportDisputeReads(args: {
  chainId: number;
  tokenId: string;
  registry?: CommercialRegistry;
}): readonly KeyedContract[] {
  const stack = commercialActive(args.chainId, args.registry);
  if (stack == null || stack.vm !== "evm") return [];
  const passport = karPassportAddress(args.chainId);
  if (passport == null) return [];
  let tid: bigint;
  try {
    tid = BigInt(args.tokenId);
  } catch {
    return [];
  }
  const wc = wagmiChainId(args.chainId);
  return [
    {
      key: "disputeWindow",
      address: passport,
      abi: KarPassportAbi,
      functionName: "DISPUTE_WINDOW",
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
  ];
}

function unreadModeFacts(configured: boolean): CommerceModeFacts {
  if (!configured) {
    return { configured: false, live: false, mandate: null };
  }
  return { configured: true, live: undefined, mandate: undefined };
}

function readModeFactsFromEntries(
  get: (key: string) => unknown | undefined,
  mode: CommerceMode,
  prefix: ModePrefix,
  configured: boolean,
  tokenId: string,
): CommerceModeFacts {
  if (!configured) {
    return { configured: false, live: false, mandate: null };
  }
  const rawPhase = get(`${prefix}.phase`);
  const phase =
    rawPhase == null ? null : parseConsignmentPhase(Number(rawPhase));
  const activeRead = get(`${prefix}.mandateActive`);
  const mandate =
    activeRead == null
      ? undefined
      : parseMandate(mode, tokenId, {
          active: activeRead === true,
          agent: get(`${prefix}.mandateAgent`) as string | undefined,
          expiry: get(`${prefix}.mandateExpiry`) as bigint | undefined,
          asset: get(`${prefix}.mandateAsset`) as string | undefined,
          denominationKind: (() => {
            const v = get(`${prefix}.mandateDenominationKind`);
            return v == null ? undefined : Number(v);
          })(),
          currencyCode: get(`${prefix}.mandateCurrencyCode`) as
            | string
            | undefined,
          floor: get(`${prefix}.mandateFloor`) as bigint | undefined,
          compensationForm: (() => {
            const v = get(`${prefix}.mandateCompensationForm`);
            return v == null ? undefined : Number(v);
          })(),
          commissionBps: (() => {
            const v = get(`${prefix}.mandateCommissionBps`);
            return v == null ? undefined : Number(v);
          })(),
        });
  return {
    configured: true,
    live: rawPhase == null ? undefined : isLiveConsignmentPhase(phase),
    mandate: mandate === undefined ? undefined : mandate,
  };
}

/** Map a PassportState / custodyLocked keyed entry onto a custody-lock fact. */
export function custodyLockFromKeyedEntry(
  entry: KeyedEntry | undefined,
  opts?: { batchPending?: boolean },
): CustodyLockRead {
  if (opts?.batchPending || entry == null) {
    return { status: "pending" };
  }
  switch (entry.status) {
    case "pending":
      return { status: "pending" };
    case "refused":
      return { status: "refused", cause: entry.cause };
    case "success": {
      if (entry.result instanceof Uint8Array) {
        const decoded = decodePassportState(entry.result);
        if (!decoded.ok) {
          return { status: "refused", cause: "malformed_response" };
        }
        return { status: "known", locked: decoded.value.custodyLocked };
      }
      if (typeof entry.result === "boolean") {
        return { status: "known", locked: entry.result };
      }
      return { status: "refused", cause: "malformed_response" };
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

/**
 * Resolve commerce facts from a plan + keyed entries.
 * Planning / unread → custody lock pending (never invent unlocked).
 */
export function resolvePassportCommerceFacts(args: {
  plan: Extract<PassportCommerceReadPlan, { ok: true }> | null;
  planning: boolean;
  entry: (key: string) => KeyedEntry | undefined;
  get: (key: string) => unknown | undefined;
  isPending: boolean;
}): PassportCommerceFacts {
  const unreadPermission = deriveEncumbrancePermission(undefined);
  const unreadRegistry = deriveEncumbranceRegistry({
    countEntry: undefined,
    atEntries: Array.from({ length: MAX_ENCUMBRANCE_SOURCES }, () => undefined),
  });
  const pendingLock: CustodyLockRead = { status: "pending" };

  if (args.planning || args.plan == null || args.plan.vm == null) {
    return {
      fixedPrice: unreadModeFacts(false),
      ascending: unreadModeFacts(false),
      openConsignmentPermission: unreadPermission,
      leaveChainPermission: unreadPermission,
      encumbranceRegistry: unreadRegistry,
      custodyLock: pendingLock,
      challengeOpen: undefined,
      liveConsignmentMode: null,
      hasLiveConsignment: undefined,
      isPending: args.planning || args.isPending,
    };
  }

  if (args.plan.vm === "svm") {
    const custodyLock = custodyLockFromKeyedEntry(
      args.entry(PASSPORT_STATE_KEY),
      { batchPending: args.isPending },
    );

    return {
      fixedPrice: unreadModeFacts(false),
      ascending: unreadModeFacts(false),
      openConsignmentPermission: unreadPermission,
      leaveChainPermission: unreadPermission,
      encumbranceRegistry: unreadRegistry,
      custodyLock,
      challengeOpen: undefined,
      liveConsignmentMode: null,
      hasLiveConsignment: false,
      isPending: args.isPending,
    };
  }

  // EVM
  const fixedPriceFacts = readModeFactsFromEntries(
    args.get,
    "fixedPrice",
    "fp",
    args.plan.fixedPriceConfigured,
    args.plan.tokenId,
  );
  const ascendingFacts = readModeFactsFromEntries(
    args.get,
    "ascending",
    "asc",
    args.plan.ascendingConfigured,
    args.plan.tokenId,
  );

  const mayOpenEntry = args.entry("mayOpen");
  const mayLeaveEntry = args.entry("mayLeave");
  const challengeOpenedAt = args.get("challengeOpenedAt");
  const custodyLock = custodyLockFromKeyedEntry(args.entry("custodyLocked"), {
    batchPending: args.isPending,
  });

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
    openConsignmentPermission: deriveEncumbrancePermission(mayOpenEntry),
    leaveChainPermission: deriveEncumbrancePermission(mayLeaveEntry),
    encumbranceRegistry: deriveEncumbranceRegistry({
      countEntry: args.entry("encumbranceSourceCount"),
      atEntries: Array.from({ length: MAX_ENCUMBRANCE_SOURCES }, (_, i) =>
        args.entry(`encumbranceSourceAt.${i}`),
      ),
    }),
    custodyLock,
    challengeOpen:
      challengeOpenedAt == null
        ? undefined
        : BigInt(String(challengeOpenedAt)) > 0n,
    liveConsignmentMode,
    hasLiveConsignment,
    isPending: args.plan.contracts.length > 0 && args.isPending,
  };
}
