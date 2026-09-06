/**
 * Commercial BPF program census for SVM raw ingest — from COMMERCIAL_ACTIVE only.
 * Six production programs (port plan §3.2). Missing any required id or start slot
 * → named refusal. Deploy evidence is deploy-machine assert only.
 */

import type {
  SvmDevnetEvidence,
  SvmDevnetProgramEvidence,
} from "./devnet-evidence";
import {
  requireSvmCommercialActive,
  type CommercialActiveBlocks,
  type SvmCommercialActiveStack,
} from "@/lib/web3/commercial-active";
import { namespaceFromLayerZeroEid } from "@/lib/web3/kargain-namespace";

/** Slug → evidence `programs` key (six production BPF programs — sole ingest census). */
export const COMMERCIAL_PROGRAM_EVIDENCE_KEYS = {
  "kar-passport": "kar_passport",
  "kar-pro-staking": "kar_pro_staking",
  "kar-pro-pass": "kar_pro_pass",
  "kar-fixed-price": "kar_fixed_price",
  "kar-ascending": "kar_ascending",
  "kar-gateway": "kar_gateway",
} as const;

export type CommercialProgramEvidenceKey =
  (typeof COMMERCIAL_PROGRAM_EVIDENCE_KEYS)[keyof typeof COMMERCIAL_PROGRAM_EVIDENCE_KEYS];

/** Ordered list of evidence keys required by assert / follow / cursor (sole census). */
export const COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST: readonly CommercialProgramEvidenceKey[] =
  Object.values(COMMERCIAL_PROGRAM_EVIDENCE_KEYS);

type StackProgramField =
  | "karPassport"
  | "karProStaking"
  | "karProPass"
  | "fixedPriceConsignment"
  | "ascendingConsignment"
  | "bridgeGateway";

type BlocksProgramField = keyof CommercialActiveBlocks;

/** Sole map: evidence key ↔ registry address field ↔ blocks start-slot field. */
export const SVM_COMMERCIAL_PROGRAM_CENSUS = [
  {
    slug: "kar-passport",
    evidenceKey: "kar_passport",
    stackField: "karPassport",
    blocksField: "karPassport",
  },
  {
    slug: "kar-pro-staking",
    evidenceKey: "kar_pro_staking",
    stackField: "karProStaking",
    blocksField: "karProStaking",
  },
  {
    slug: "kar-pro-pass",
    evidenceKey: "kar_pro_pass",
    stackField: "karProPass",
    blocksField: "karProPass",
  },
  {
    slug: "kar-fixed-price",
    evidenceKey: "kar_fixed_price",
    stackField: "fixedPriceConsignment",
    blocksField: "fixedPriceConsignment",
  },
  {
    slug: "kar-ascending",
    evidenceKey: "kar_ascending",
    stackField: "ascendingConsignment",
    blocksField: "ascendingConsignment",
  },
  {
    slug: "kar-gateway",
    evidenceKey: "kar_gateway",
    stackField: "bridgeGateway",
    blocksField: "bridgeGateway",
  },
] as const satisfies ReadonlyArray<{
  slug: string;
  evidenceKey: CommercialProgramEvidenceKey;
  stackField: StackProgramField;
  blocksField: BlocksProgramField;
}>;

export type FollowedProgram = {
  slug: string;
  programId: string;
  evidenceKey: string;
  /** Per-program discovery floor from COMMERCIAL_ACTIVE.blocks. */
  deploySlot: number;
};

export class MissingCommercialProgramError extends Error {
  readonly missingEvidenceKeys: readonly string[];

  constructor(missingEvidenceKeys: readonly string[]) {
    const list = missingEvidenceKeys.join(", ");
    super(
      `SVM commercial stack missing required program(s): ${list} — ` +
        `each of six needs programId + deploySlot in COMMERCIAL_ACTIVE.blocks`,
    );
    this.name = "MissingCommercialProgramError";
    this.missingEvidenceKeys = missingEvidenceKeys;
  }
}

function isValidDeploySlot(slot: unknown): slot is number {
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 0;
}

export type CommercialProgramCensusGapCause =
  | "missing_program_id"
  | "missing_deploy_slot";

export type CommercialProgramCensusGap = {
  key: CommercialProgramEvidenceKey;
  cause: CommercialProgramCensusGapCause;
};

function stackProgramId(
  stack: SvmCommercialActiveStack,
  field: StackProgramField,
): string | undefined {
  const value = stack[field];
  return typeof value === "string" ? value.trim() : undefined;
}

/**
 * Sole completeness predicate for the six commercial keys on a registry stack.
 * Gate and verify summary both consume this — no second truth.
 * Does not read `mock_staking`.
 */
export function commercialProgramCensusGaps(
  stack: SvmCommercialActiveStack,
): CommercialProgramCensusGap[] {
  const gaps: CommercialProgramCensusGap[] = [];
  for (const row of SVM_COMMERCIAL_PROGRAM_CENSUS) {
    const programId = stackProgramId(stack, row.stackField);
    if (!programId) {
      gaps.push({ key: row.evidenceKey, cause: "missing_program_id" });
      continue;
    }
    if (!isValidDeploySlot(stack.blocks[row.blocksField])) {
      gaps.push({ key: row.evidenceKey, cause: "missing_deploy_slot" });
    }
  }
  return gaps;
}

/**
 * Deploy-machine / evidence-file completeness (scripts only).
 * Runtime ingest uses {@link commercialProgramCensusGaps} on the registry stack.
 */
export function commercialProgramCensusGapsFromEvidence(
  evidence: SvmDevnetEvidence,
): CommercialProgramCensusGap[] {
  const gaps: CommercialProgramCensusGap[] = [];
  for (const row of SVM_COMMERCIAL_PROGRAM_CENSUS) {
    const program: SvmDevnetProgramEvidence | undefined =
      evidence.programs[row.evidenceKey];
    const programId = program?.programId?.trim();
    if (!programId) {
      gaps.push({ key: row.evidenceKey, cause: "missing_program_id" });
      continue;
    }
    if (!isValidDeploySlot(program?.deploySlot)) {
      gaps.push({ key: row.evidenceKey, cause: "missing_deploy_slot" });
    }
  }
  return gaps;
}

/**
 * Refuse incomplete commercial stack by key name.
 * Requires programId and blocks start slot on each of the six census keys.
 */
export function assertSvmCommercialStack(stack: SvmCommercialActiveStack): void {
  const gaps = commercialProgramCensusGaps(stack);
  if (gaps.length > 0) {
    throw new MissingCommercialProgramError(gaps.map((g) => g.key));
  }
}

/**
 * @deprecated Prefer {@link assertSvmCommercialStack}. Kept as an alias so
 * deploy-machine evidence completeness can still be named at call sites that
 * temporarily wrap evidence → synthetic checks via
 * {@link commercialProgramCensusGapsFromEvidence}.
 */
export function assertSvmCommercialEvidence(evidence: SvmDevnetEvidence): void {
  const gaps = commercialProgramCensusGapsFromEvidence(evidence);
  if (gaps.length > 0) {
    throw new MissingCommercialProgramError(gaps.map((g) => g.key));
  }
}

/**
 * All six commercial programs must be present with a programId and start slot.
 * Silent skip of missing keys is forbidden. Never includes `mock_staking`.
 */
export function followedProgramsFromStack(
  stack: SvmCommercialActiveStack,
): FollowedProgram[] {
  assertSvmCommercialStack(stack);
  return SVM_COMMERCIAL_PROGRAM_CENSUS.map((row) => ({
    slug: row.slug,
    programId: stackProgramId(stack, row.stackField)!,
    evidenceKey: row.evidenceKey,
    deploySlot: stack.blocks[row.blocksField]!,
  }));
}

export function followedProgramIdSet(programs: readonly FollowedProgram[]): Set<string> {
  return new Set(programs.map((p) => p.programId));
}

/**
 * Follow cursor = minimum blocks start slot over the six commercial programs.
 * No env or single precomputed cursor field.
 */
export function resolveIngestStartSlot(stack: SvmCommercialActiveStack): number {
  assertSvmCommercialStack(stack);
  let min = Number.POSITIVE_INFINITY;
  for (const row of SVM_COMMERCIAL_PROGRAM_CENSUS) {
    const slot = stack.blocks[row.blocksField]!;
    if (slot < min) min = slot;
  }
  return min;
}

/**
 * Resolve the live SVM commercial stack for ingest.
 * EID → reserved namespace → COMMERCIAL_ACTIVE; optional SVM_INGEST_NAMESPACE confirm.
 */
export function resolveIngestCommercialStack(opts?: {
  eid?: number;
  namespaceEnv?: string | undefined;
}): SvmCommercialActiveStack {
  const eid =
    opts?.eid ??
    Number(process.env.SVM_INGEST_EID?.trim() ?? "40168");
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new Error(`SVM_INGEST_EID must be a positive integer (got ${eid})`);
  }
  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  const envRaw =
    opts?.namespaceEnv !== undefined
      ? opts.namespaceEnv?.trim()
      : process.env.SVM_INGEST_NAMESPACE?.trim();
  const envParsed =
    envRaw && Number.isInteger(Number(envRaw)) ? Number(envRaw) : undefined;
  const stackNs = Number(stack.namespace);
  if (envParsed !== undefined && envParsed !== stackNs) {
    throw new Error(
      `SVM ingest namespace mismatch: SVM_INGEST_NAMESPACE=${envParsed} ` +
        `COMMERCIAL_ACTIVE.namespace=${stackNs}`,
    );
  }
  return stack;
}

/** Namespace of the resolved ingest stack (after optional env confirm). */
export function resolveIngestNamespace(stack: SvmCommercialActiveStack): number {
  assertSvmCommercialStack(stack);
  return Number(stack.namespace);
}

export const DEFAULT_CATCHUP_MAX_LAG_SLOTS = 216_000;

/** Shared RPC budget for signature pages + getBlock (public Devnet ~40/10s/method). */
export const DEFAULT_INGEST_MAX_RPS = 3;

export function resolveCatchupMaxLagSlots(): number {
  const raw = process.env.SVM_INGEST_CATCHUP_MAX_LAG_SLOTS?.trim();
  if (!raw) return DEFAULT_CATCHUP_MAX_LAG_SLOTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("SVM_INGEST_CATCHUP_MAX_LAG_SLOTS must be a positive integer");
  }
  return parsed;
}

export function resolveIngestMaxRps(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SVM_INGEST_MAX_RPS?.trim();
  if (!raw) return DEFAULT_INGEST_MAX_RPS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("SVM_INGEST_MAX_RPS must be a positive number");
  }
  return parsed;
}
