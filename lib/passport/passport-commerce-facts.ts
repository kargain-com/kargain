/**
 * Sole dual-VM owner of passport commerce chrome reads (U9.2a / S8-D1b / 9.3c).
 *
 * EVM: batched may / custodyLocked (ABI key) / encumbrance / mode phase+mandate.
 * SVM: keyed PassportState + mode consignment/mandate + challenge + PassportConfig;
 * may_* from simulatePassportMay (injected gates) — never a TS copy of may.rs.
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
} from "@/lib/passport/commerce-fact";
import {
  deriveEncumbrancePermission,
  type EncumbrancePermissionGate,
} from "@/lib/passport/encumbrance-permission";
import {
  deriveEncumbranceRegistry,
  encumbranceRegistryFromProgramIds,
  MAX_ENCUMBRANCE_SOURCES,
  type EncumbranceRegistry,
} from "@/lib/passport/encumbrance-registry";
import { type CustodyLockRead } from "@/lib/passport/presence";
import {
  decodeChallengeAccount,
  decodeConsignmentRecord,
  decodeMandateRecord,
  decodePassportConfig,
  decodePassportState,
  type EncumbranceSourceDecoded,
} from "@/lib/svm/decode-account-state";
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
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { toHex } from "viem";

export const PASSPORT_STATE_KEY = "passportState" as const;
export const PASSPORT_CONFIG_KEY = "passportConfig" as const;
export const CHALLENGE_ACCOUNT_KEY = "challenge" as const;
export const FP_CONSIGNMENT_KEY = "fp.consignment" as const;
export const FP_MANDATE_KEY = "fp.mandate" as const;
export const ASC_CONSIGNMENT_KEY = "asc.consignment" as const;
export const ASC_MANDATE_KEY = "asc.mandate" as const;

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
      contracts: readonly KeyedContract[];
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
 * PassportState + config + challenge + per-mode consignment/mandate/recall
 * (+ Ascending auction/hold). Unregistered → empty (honest unread).
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

  return planSvmCommerceReads(stack, args.tokenId);
}

async function planSvmCommerceReads(
  stack: SvmCommercialActiveStack,
  tokenId: string,
): Promise<PassportCommerceReadPlan> {
  let tokenBytes: Uint8Array;
  try {
    tokenBytes = tokenIdToBytes32(tokenId);
  } catch (err) {
    return {
      ok: false,
      cause: "invalid_token_id",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const contracts: KeyedContract[] = [];
  const tokenSeeds = { token_id: tokenBytes };

  async function push(
    key: string,
    recipe: string,
    programId: string,
    seeds?: Record<string, Uint8Array>,
  ): Promise<{ ok: true } | { ok: false; detail: string }> {
    const pda = await deriveSvmPda({
      recipe,
      programId,
      seeds: seeds ?? {},
    });
    if (!pda.ok) {
      return { ok: false, detail: `${pda.cause}:${pda.detail}` };
    }
    contracts.push({ key, vm: "svm", account: pda.address });
    return { ok: true };
  }

  for (const step of [
    () => push(PASSPORT_STATE_KEY, "kar-passport/state", stack.karPassport, tokenSeeds),
    () => push(PASSPORT_CONFIG_KEY, "kar-passport/config", stack.karPassport),
    () =>
      push(
        CHALLENGE_ACCOUNT_KEY,
        "kargain-bonded-challenge/challenge",
        stack.karPassport,
        { subject_id: tokenBytes },
      ),
  ] as const) {
    const r = await step();
    if (!r.ok) {
      return { ok: false, cause: "pda_failed", detail: r.detail };
    }
  }

  if (stack.fixedPriceConsignment) {
    const mode = stack.fixedPriceConsignment;
    for (const [key, recipe] of [
      [FP_CONSIGNMENT_KEY, "kargain-consignment-base/consignment"],
      [FP_MANDATE_KEY, "kargain-consignment-base/mandate"],
    ] as const) {
      const r = await push(key, recipe, mode, tokenSeeds);
      if (!r.ok) {
        return { ok: false, cause: "pda_failed", detail: r.detail };
      }
    }
  }

  if (stack.ascendingConsignment) {
    const mode = stack.ascendingConsignment;
    for (const [key, recipe] of [
      [ASC_CONSIGNMENT_KEY, "kargain-consignment-base/consignment"],
      [ASC_MANDATE_KEY, "kargain-consignment-base/mandate"],
    ] as const) {
      const r = await push(key, recipe, mode, tokenSeeds);
      if (!r.ok) {
        return { ok: false, cause: "pda_failed", detail: r.detail };
      }
    }
  }

  return {
    ok: true,
    vm: "svm",
    tokenId,
    namespace: Number(stack.namespace),
    fixedPriceConfigured: Boolean(stack.fixedPriceConsignment),
    ascendingConfigured: Boolean(stack.ascendingConsignment),
    contracts,
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

/**
 * SVM planning flash: may_* wait until simulate; supported commerce
 * reads wait honestly (pending) until keyed entries arrive — never invent false.
 */
function svmPlanningFacts(
  stack: SvmCommercialActiveStack,
  isPending: boolean,
  _registry?: CommercialRegistry,
): PassportCommerceFacts {
  const namespace = Number(stack.namespace);
  const fixedPriceConfigured = Boolean(stack.fixedPriceConsignment);
  const ascendingConfigured = Boolean(stack.ascendingConsignment);
  const fixedPrice: CommerceModeFacts = fixedPriceConfigured
    ? {
        configured: true,
        live: commerceFactPending(),
        mandate: commerceFactPending(),
      }
    : unconfiguredModeFacts();
  const ascending: CommerceModeFacts = ascendingConfigured
    ? {
        configured: true,
        live: commerceFactPending(),
        mandate: commerceFactPending(),
      }
    : unconfiguredModeFacts();
  const combined = combinePhaseFacts(fixedPrice.live, ascending.live);
  return {
    fixedPrice,
    ascending,
    openConsignmentPermission: { status: "blocked", cause: "reads_unresolved" },
    leaveChainPermission: { status: "blocked", cause: "reads_unresolved" },
    encumbranceRegistry: commerceFactPending(),
    custodyLock: { status: "pending" },
    challengeOpen: commerceFactPending(),
    liveConsignmentMode: combined.liveConsignmentMode,
    hasLiveConsignment: combined.hasLiveConsignment,
    isPending,
  };
}

function bytes32CurrencyHex(bytes: Uint8Array): `0x${string}` {
  return toHex(bytes, { size: 32 });
}

/**
 * Live phase from a consignment keyed entry.
 * Absent account → known(false). Pending/missing → pending. Never invent false
 * from refused/pending.
 */
function liveFactFromConsignmentEntry(
  entry: KeyedEntry | undefined,
  opts?: { batchPending?: boolean },
): CommerceFact<boolean> {
  if (opts?.batchPending || entry == null) {
    return commerceFactPending();
  }
  switch (entry.status) {
    case "pending":
      return commerceFactPending();
    case "refused":
      if (entry.cause === "account_not_found") {
        return commerceFactKnown(false);
      }
      return commerceFactRefused(entry.cause);
    case "success": {
      if (!(entry.result instanceof Uint8Array)) {
        return commerceFactRefused("malformed_response");
      }
      const decoded = decodeConsignmentRecord(entry.result);
      if (!decoded.ok) {
        return commerceFactRefused("malformed_response");
      }
      const phase = parseConsignmentPhase(decoded.value.phase);
      return commerceFactKnown(isLiveConsignmentPhase(phase));
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

/**
 * Mandate from a mandate keyed entry.
 * Absent account → known(null). Pending/missing → pending.
 */
function mandateFactFromMandateEntry(
  entry: KeyedEntry | undefined,
  args: {
    namespace: number;
    mode: CommerceMode;
    tokenId: string;
    batchPending?: boolean;
  },
): CommerceFact<MandateSnapshot | null> {
  if (args.batchPending || entry == null) {
    return commerceFactPending();
  }
  switch (entry.status) {
    case "pending":
      return commerceFactPending();
    case "refused":
      if (entry.cause === "account_not_found") {
        return commerceFactKnown(null);
      }
      return commerceFactRefused(entry.cause);
    case "success": {
      if (!(entry.result instanceof Uint8Array)) {
        return commerceFactRefused("malformed_response");
      }
      const decoded = decodeMandateRecord(entry.result);
      if (!decoded.ok) {
        return commerceFactRefused("malformed_response");
      }
      const v = decoded.value;
      const mandate = parseMandate(args.namespace, args.mode, args.tokenId, {
        active: v.active,
        agent: v.agent,
        expiry: v.expiry,
        asset: v.asset,
        denominationKind: v.kind,
        currencyCode: bytes32CurrencyHex(v.currencyCode),
        floor: v.floor,
        compensationForm: v.form,
        commissionBps: v.commissionBps,
      });
      return commerceFactKnown(mandate);
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

function challengeOpenFromEntry(
  entry: KeyedEntry | undefined,
  opts?: { batchPending?: boolean },
): CommerceFact<boolean> {
  if (opts?.batchPending || entry == null) {
    return commerceFactPending();
  }
  switch (entry.status) {
    case "pending":
      return commerceFactPending();
    case "refused":
      if (entry.cause === "account_not_found") {
        return commerceFactKnown(false);
      }
      return commerceFactRefused(entry.cause);
    case "success": {
      if (!(entry.result instanceof Uint8Array)) {
        return commerceFactRefused("malformed_response");
      }
      const decoded = decodeChallengeAccount(entry.result);
      if (!decoded.ok) {
        return commerceFactRefused("malformed_response");
      }
      return commerceFactKnown(decoded.value.openedAt !== 0n);
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

function registryFromConfigEntry(
  entry: KeyedEntry | undefined,
  namespace: number,
  opts?: { batchPending?: boolean },
): EncumbranceRegistry {
  if (opts?.batchPending || entry == null) {
    return commerceFactPending();
  }
  switch (entry.status) {
    case "pending":
      return commerceFactPending();
    case "refused":
      // Absent config is anomalous — refuse by name; never invent [].
      return commerceFactRefused(entry.cause);
    case "success": {
      if (!(entry.result instanceof Uint8Array)) {
        return commerceFactRefused("malformed_response");
      }
      const decoded = decodePassportConfig(entry.result);
      if (!decoded.ok) {
        return commerceFactRefused("malformed_response");
      }
      return encumbranceRegistryFromProgramIds({
        namespace,
        programIds: decoded.value.encumbranceSources.map((s) => s.programId),
      });
    }
    default: {
      const _exhaustive: never = entry;
      return _exhaustive;
    }
  }
}

/**
 * Encumbrance sources (program id + seed prefix) from the same passportConfig
 * keyed entry used for the registry fact. Re-decode — do not invent prefixes
 * from ProtocolOwner[]. Pending/refused → null (caller fails closed).
 */
export function encumbranceSourcesFromConfigEntry(
  entry: KeyedEntry | undefined,
  opts?: { batchPending?: boolean },
): readonly EncumbranceSourceDecoded[] | null {
  if (opts?.batchPending || entry == null) return null;
  if (entry.status === "pending") return null;
  if (entry.status === "refused") return null;
  if (!(entry.result instanceof Uint8Array)) return null;
  const decoded = decodePassportConfig(entry.result);
  if (!decoded.ok) return null;
  return decoded.value.encumbranceSources;
}

function resolveSvmModeFacts(args: {
  consignmentEntry: KeyedEntry | undefined;
  mandateEntry: KeyedEntry | undefined;
  namespace: number;
  mode: CommerceMode;
  tokenId: string;
  batchPending: boolean;
}): CommerceModeFacts {
  return {
    configured: true,
    live: liveFactFromConsignmentEntry(args.consignmentEntry, {
      batchPending: args.batchPending,
    }),
    mandate: mandateFactFromMandateEntry(args.mandateEntry, {
      namespace: args.namespace,
      mode: args.mode,
      tokenId: args.tokenId,
      batchPending: args.batchPending,
    }),
  };
}

function resolveSvmCommerceFacts(args: {
  plan: Extract<PassportCommerceReadPlan, { ok: true; vm: "svm" }>;
  entry: (key: string) => KeyedEntry | undefined;
  isPending: boolean;
  registry?: CommercialRegistry;
  /** Injected from simulatePassportMay; omitted → reads_unresolved. */
  mayPermissions?: {
    openConsignmentPermission: EncumbrancePermissionGate;
    leaveChainPermission: EncumbrancePermissionGate;
  };
}): PassportCommerceFacts {
  const { plan } = args;
  const batchPending = args.isPending;
  const fixedPrice = plan.fixedPriceConfigured
    ? resolveSvmModeFacts({
        consignmentEntry: args.entry(FP_CONSIGNMENT_KEY),
        mandateEntry: args.entry(FP_MANDATE_KEY),
        namespace: plan.namespace,
        mode: "fixedPrice",
        tokenId: plan.tokenId,
        batchPending,
      })
    : unconfiguredModeFacts();
  const ascending = plan.ascendingConfigured
    ? resolveSvmModeFacts({
        consignmentEntry: args.entry(ASC_CONSIGNMENT_KEY),
        mandateEntry: args.entry(ASC_MANDATE_KEY),
        namespace: plan.namespace,
        mode: "ascending",
        tokenId: plan.tokenId,
        batchPending,
      })
    : unconfiguredModeFacts();
  const combined = combinePhaseFacts(fixedPrice.live, ascending.live);
  const custodyLock = custodyLockFromKeyedEntry(
    args.entry(PASSPORT_STATE_KEY),
    { batchPending },
  );

  const unreadMay: EncumbrancePermissionGate = {
    status: "blocked",
    cause: "reads_unresolved",
  };

  return {
    fixedPrice,
    ascending,
    openConsignmentPermission:
      args.mayPermissions?.openConsignmentPermission ?? unreadMay,
    leaveChainPermission:
      args.mayPermissions?.leaveChainPermission ?? unreadMay,
    encumbranceRegistry: registryFromConfigEntry(
      args.entry(PASSPORT_CONFIG_KEY),
      plan.namespace,
      { batchPending },
    ),
    custodyLock,
    challengeOpen: challengeOpenFromEntry(args.entry(CHALLENGE_ACCOUNT_KEY), {
      batchPending,
    }),
    liveConsignmentMode: combined.liveConsignmentMode,
    hasLiveConsignment: combined.hasLiveConsignment,
    isPending: plan.contracts.length > 0 && args.isPending,
  };
}

function readModeFactsFromEntries(
  get: (key: string) => unknown | undefined,
  mode: CommerceMode,
  prefix: ModePrefix,
  configured: boolean,
  tokenId: string,
  namespace: number,
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
      : parseMandate(namespace, mode, tokenId, {
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
  /** SVM only — from simulatePassportMay (hook). */
  mayPermissions?: {
    openConsignmentPermission: EncumbrancePermissionGate;
    leaveChainPermission: EncumbrancePermissionGate;
  };
}): PassportCommerceFacts {
  const unreadPermission = deriveEncumbrancePermission(undefined);
  const unreadRegistry = commerceFactPending() as EncumbranceRegistry;
  const pendingLock: CustodyLockRead = { status: "pending" };
  const pendingCombined = combinePhaseFacts(
    commerceFactPending(),
    commerceFactPending(),
  );

  if (args.planning || args.plan == null || args.plan.vm == null) {
    // SVM planning: refuse may_* by census; supported reads stay pending.
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
    return resolveSvmCommerceFacts({
      plan: args.plan,
      entry: args.entry,
      isPending: args.isPending,
      registry: args.registry,
      mayPermissions: args.mayPermissions,
    });
  }

  // EVM
  const namespace = args.namespace ?? 0;
  const fixedPriceFacts = readModeFactsFromEntries(
    args.get,
    "fixedPrice",
    "fp",
    args.plan.fixedPriceConfigured,
    args.plan.tokenId,
    namespace,
  );
  const ascendingFacts = readModeFactsFromEntries(
    args.get,
    "ascending",
    "asc",
    args.plan.ascendingConfigured,
    args.plan.tokenId,
    namespace,
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
    openConsignmentPermission: deriveEncumbrancePermission(mayOpenEntry, {
      namespace,
    }),
    leaveChainPermission: deriveEncumbrancePermission(mayLeaveEntry, {
      namespace,
    }),
    encumbranceRegistry: deriveEncumbranceRegistry({
      namespace,
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
