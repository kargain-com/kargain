/**
 * Sole dual-VM owner of passport commerce chrome reads (U9.2a / S8-D1b).
 *
 * EVM: batched may / custodyLocked (ABI key) / encumbrance / mode phase+mandate.
 * SVM: PassportState keyed-read → custodyLock fact; other commerce facts ask
 * surfaceSupport and refuse by named cause — never invent false / unlocked.
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
  combinePhaseFacts,
  commerceFactKnown,
  commerceFactPending,
  commerceFactRefused,
  type CommerceFact,
  type SurfaceSupportCause,
} from "@/lib/passport/commerce-fact";
import {
  deriveEncumbrancePermission,
  encumbrancePermissionFromSupport,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import {
  deriveEncumbranceRegistry,
  encumbranceRegistryFromSupport,
  MAX_ENCUMBRANCE_SOURCES,
  type EncumbranceRegistry,
} from "@/lib/passport/encumbrance-registry";
import { type CustodyLockRead } from "@/lib/passport/presence";
import { decodePassportState } from "@/lib/svm/decode-account-state";
import { deriveSvmPda } from "@/lib/svm/derive-pda";
import { tokenIdToBytes32 } from "@/lib/svm/event-payload-decode";
import {
  commercialActive,
  type CommercialRegistry,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import type {
  KeyedContract,
  KeyedEntry,
} from "@/lib/web3/keyed-multicall";
import {
  surfaceSupport,
  type SurfaceCapability,
} from "@/lib/web3/surface-support";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export const PASSPORT_STATE_KEY = "passportState" as const;

export type {
  CommerceFact,
  CommerceFactCause,
  SurfaceSupportCause,
} from "@/lib/passport/commerce-fact";

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
  /** Registry fact — never inferred from a missing keyed read. */
  configured: boolean;
  live: CommerceFact<boolean>;
  mandate: CommerceFact<MandateSnapshot | null>;
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
  challengeOpen: CommerceFact<boolean>;
  /** Mode holding a live consignment, when exactly one does. */
  liveConsignmentMode: CommerceFact<CommerceMode | null>;
  /** Known only when both mode phase facts are known. */
  hasLiveConsignment: CommerceFact<boolean>;
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
      namespace: number;
      fixedPriceConfigured: boolean;
      ascendingConfigured: boolean;
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
    namespace: Number(stack.namespace),
    fixedPriceConfigured: Boolean(stack.fixedPriceConsignment),
    ascendingConfigured: Boolean(stack.ascendingConsignment),
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

/** Unconfigured mode — live known false, mandate known null (EVM parity). */
function unconfiguredModeFacts(): CommerceModeFacts {
  return {
    configured: false,
    live: commerceFactKnown(false),
    mandate: commerceFactKnown(null),
  };
}

function supportCauseFromCell(
  capability: SurfaceCapability,
  namespace: number,
  registry?: CommercialRegistry,
): SurfaceSupportCause | "unresolved_namespace" | null {
  const cell = surfaceSupport(capability, namespace, registry);
  if ("unresolved" in cell) return "unresolved_namespace";
  if (!cell.supported) return cell.cause;
  return null;
}

function modeFactsFromSupport(args: {
  configured: boolean;
  phaseCapability: SurfaceCapability;
  mandateCapability: SurfaceCapability;
  namespace: number;
  registry?: CommercialRegistry;
}): CommerceModeFacts {
  if (!args.configured) return unconfiguredModeFacts();

  const phaseCause = supportCauseFromCell(
    args.phaseCapability,
    args.namespace,
    args.registry,
  );
  const mandateCause = supportCauseFromCell(
    args.mandateCapability,
    args.namespace,
    args.registry,
  );

  const live: CommerceFact<boolean> =
    phaseCause == null
      ? commerceFactPending()
      : phaseCause === "unresolved_namespace"
        ? commerceFactRefused("unresolved_namespace")
        : commerceFactRefused(phaseCause);

  const mandate: CommerceFact<MandateSnapshot | null> =
    mandateCause == null
      ? commerceFactPending()
      : mandateCause === "unresolved_namespace"
        ? commerceFactRefused("unresolved_namespace")
        : commerceFactRefused(mandateCause);

  return { configured: true, live, mandate };
}

function permissionFromSupport(
  capability: SurfaceCapability,
  namespace: number,
  registry?: CommercialRegistry,
): EncumbrancePermissionGate {
  const cause = supportCauseFromCell(capability, namespace, registry);
  if (cause == null) {
    // Supported but no reader yet — still product_owner_owed in census for these.
    // If somehow supported, treat as pending read (should not happen for owed cells).
    return { status: "blocked", cause: "reads_unresolved" };
  }
  if (cause === "unresolved_namespace") {
    return { status: "blocked", cause: "reads_unresolved" };
  }
  return encumbrancePermissionFromSupport(cause);
}

function registryFromSupport(
  namespace: number,
  registry?: CommercialRegistry,
): EncumbranceRegistry {
  const cause = supportCauseFromCell(
    "encumbrance_registry",
    namespace,
    registry,
  );
  if (cause == null) {
    return commerceFactPending();
  }
  if (cause === "unresolved_namespace") {
    return commerceFactRefused("unresolved_namespace");
  }
  return encumbranceRegistryFromSupport(cause);
}

function challengeOpenFromSupport(
  namespace: number,
  registry?: CommercialRegistry,
): CommerceFact<boolean> {
  const cause = supportCauseFromCell("challenge_open", namespace, registry);
  if (cause == null) {
    // Supported cell with no reader yet — wait for the keyed ChallengeAccount read.
    return commerceFactPending();
  }
  if (cause === "unresolved_namespace") {
    return commerceFactRefused("unresolved_namespace");
  }
  return commerceFactRefused(cause);
}

function svmCommerceFacts(args: {
  namespace: number;
  fixedPriceConfigured: boolean;
  ascendingConfigured: boolean;
  custodyLock: CustodyLockRead;
  isPending: boolean;
  registry?: CommercialRegistry;
}): PassportCommerceFacts {
  const fixedPrice = modeFactsFromSupport({
    configured: args.fixedPriceConfigured,
    phaseCapability: "fixed_price_consignment_phase",
    mandateCapability: "mandate_snapshot",
    namespace: args.namespace,
    registry: args.registry,
  });
  const ascending = modeFactsFromSupport({
    configured: args.ascendingConfigured,
    phaseCapability: "ascending_consignment_phase",
    mandateCapability: "mandate_snapshot",
    namespace: args.namespace,
    registry: args.registry,
  });
  const combined = combinePhaseFacts(fixedPrice.live, ascending.live);

  return {
    fixedPrice,
    ascending,
    openConsignmentPermission: permissionFromSupport(
      "may_open_consignment",
      args.namespace,
      args.registry,
    ),
    leaveChainPermission: permissionFromSupport(
      "may_leave_chain",
      args.namespace,
      args.registry,
    ),
    encumbranceRegistry: registryFromSupport(args.namespace, args.registry),
    custodyLock: args.custodyLock,
    challengeOpen: challengeOpenFromSupport(args.namespace, args.registry),
    liveConsignmentMode: combined.liveConsignmentMode,
    hasLiveConsignment: combined.hasLiveConsignment,
    isPending: args.isPending,
  };
}

/**
 * SVM planning flash: apply support refusals as soon as the commercial row is
 * known so the PDA wait does not invent "modes not deployed".
 */
function svmPlanningFacts(
  stack: SvmCommercialActiveStack,
  isPending: boolean,
  registry?: CommercialRegistry,
): PassportCommerceFacts {
  return svmCommerceFacts({
    namespace: Number(stack.namespace),
    fixedPriceConfigured: Boolean(stack.fixedPriceConsignment),
    ascendingConfigured: Boolean(stack.ascendingConsignment),
    custodyLock: { status: "pending" },
    isPending,
    registry,
  });
}

function readModeFactsFromEntries(
  get: (key: string) => unknown | undefined,
  mode: CommerceMode,
  prefix: ModePrefix,
  configured: boolean,
  tokenId: string,
): CommerceModeFacts {
  if (!configured) {
    return unconfiguredModeFacts();
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
    live:
      rawPhase == null
        ? commerceFactPending()
        : commerceFactKnown(isLiveConsignmentPhase(phase)),
    mandate:
      mandate === undefined
        ? commerceFactPending()
        : commerceFactKnown(mandate),
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
 * Optional `namespace` / `registry` let the SVM planning path refuse by support
 * without waiting for the PDA plan.
 */
export function resolvePassportCommerceFacts(args: {
  plan: Extract<PassportCommerceReadPlan, { ok: true }> | null;
  planning: boolean;
  entry: (key: string) => KeyedEntry | undefined;
  get: (key: string) => unknown | undefined;
  isPending: boolean;
  /** When planning and the commercial row is already known (SVM flash). */
  namespace?: number;
  registry?: CommercialRegistry;
}): PassportCommerceFacts {
  const unreadPermission = deriveEncumbrancePermission(undefined);
  const unreadRegistry = deriveEncumbranceRegistry({
    countEntry: undefined,
    atEntries: Array.from({ length: MAX_ENCUMBRANCE_SOURCES }, () => undefined),
  });
  const pendingLock: CustodyLockRead = { status: "pending" };
  const pendingCombined = combinePhaseFacts(
    commerceFactPending(),
    commerceFactPending(),
  );

  if (args.planning || args.plan == null || args.plan.vm == null) {
    // SVM planning: refuse by census as soon as the commercial row is known.
    if (args.namespace != null) {
      const stack = commercialActive(args.namespace, args.registry);
      if (stack?.vm === "svm") {
        return svmPlanningFacts(
          stack,
          args.planning || args.isPending,
          args.registry,
        );
      }
    }
    // EVM / unknown — keep unconfigured flash (localhost / hub parity).
    return {
      fixedPrice: unconfiguredModeFacts(),
      ascending: unconfiguredModeFacts(),
      openConsignmentPermission: unreadPermission,
      leaveChainPermission: unreadPermission,
      encumbranceRegistry: unreadRegistry,
      custodyLock: pendingLock,
      challengeOpen: commerceFactPending(),
      liveConsignmentMode: pendingCombined.liveConsignmentMode,
      hasLiveConsignment: pendingCombined.hasLiveConsignment,
      isPending: args.planning || args.isPending,
    };
  }

  if (args.plan.vm === "svm") {
    const custodyLock = custodyLockFromKeyedEntry(
      args.entry(PASSPORT_STATE_KEY),
      { batchPending: args.isPending },
    );
    return svmCommerceFacts({
      namespace: args.plan.namespace,
      fixedPriceConfigured: args.plan.fixedPriceConfigured,
      ascendingConfigured: args.plan.ascendingConfigured,
      custodyLock,
      isPending: args.isPending,
      registry: args.registry,
    });
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

  const combined = combinePhaseFacts(
    fixedPriceFacts.live,
    ascendingFacts.live,
  );

  const challengeOpen: CommerceFact<boolean> =
    challengeOpenedAt == null
      ? commerceFactPending()
      : commerceFactKnown(BigInt(String(challengeOpenedAt)) > 0n);

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
    challengeOpen,
    liveConsignmentMode: combined.liveConsignmentMode,
    hasLiveConsignment: combined.hasLiveConsignment,
    isPending: args.plan.contracts.length > 0 && args.isPending,
  };
}
