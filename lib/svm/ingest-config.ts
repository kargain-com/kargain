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

export type SvmIngestRuntimeRefusalCode =
  | "missing_solana_rpc_url"
  | "missing_database_url"
  | "invalid_svm_ingest_eid"
  | "svm_ingest_namespace_mismatch"
  | "invalid_catchup_max_lag_slots"
  | "invalid_ingest_max_rps"
  | "missing_commercial_program";

/** Typed svm-ingest runtime refusal: closed code + env key (when applicable). */
export class SvmIngestRuntimeRefusalError extends Error {
  readonly code: SvmIngestRuntimeRefusalCode;
  readonly envKey: string | undefined;
  readonly evidenceKeys: readonly string[] | undefined;

  constructor(
    code: SvmIngestRuntimeRefusalCode,
    message: string,
    opts?: { envKey?: string; evidenceKeys?: readonly string[] },
  ) {
    super(message);
    this.name = "SvmIngestRuntimeRefusalError";
    this.code = code;
    this.envKey = opts?.envKey;
    this.evidenceKeys = opts?.evidenceKeys;
  }
}

/**
 * Census gap refusal — same typed refusal as the rest of the runtime owner
 * (`missing_commercial_program`). Missing keys live only on inherited
 * {@link SvmIngestRuntimeRefusalError.evidenceKeys}.
 */
export class MissingCommercialProgramError extends SvmIngestRuntimeRefusalError {
  constructor(evidenceKeys: readonly string[]) {
    const list = evidenceKeys.join(", ");
    super(
      "missing_commercial_program",
      `SVM commercial stack missing required program(s): ${list} — ` +
        `each of six needs programId + deploySlot in COMMERCIAL_ACTIVE.blocks`,
      { evidenceKeys },
    );
    this.name = "MissingCommercialProgramError";
  }
}

function unsetEnv(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
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

/** Sole default for SVM_INGEST_EID when unset (LayerZero Solana Devnet EID). */
export const DEFAULT_SVM_INGEST_EID = 40168;

/**
 * Resolve the live SVM commercial stack for ingest.
 * EID → reserved namespace → COMMERCIAL_ACTIVE; optional SVM_INGEST_NAMESPACE confirm.
 * Owns the EID default; callers pass `env` rather than reading `process.env` here.
 */
export function resolveIngestCommercialStack(opts?: {
  eid?: number;
  namespaceEnv?: string | undefined;
  env?: NodeJS.ProcessEnv;
}): SvmCommercialActiveStack {
  const env = opts?.env ?? process.env;
  const eid =
    opts?.eid ??
    Number(unsetEnv(env.SVM_INGEST_EID) ?? String(DEFAULT_SVM_INGEST_EID));
  if (!Number.isInteger(eid) || eid <= 0) {
    throw new SvmIngestRuntimeRefusalError(
      "invalid_svm_ingest_eid",
      `SVM_INGEST_EID must be a positive integer (got ${eid})`,
      { envKey: "SVM_INGEST_EID" },
    );
  }
  const namespace = namespaceFromLayerZeroEid(eid);
  const stack = requireSvmCommercialActive(namespace);

  const envRaw =
    opts?.namespaceEnv !== undefined
      ? unsetEnv(opts.namespaceEnv)
      : unsetEnv(env.SVM_INGEST_NAMESPACE);
  const envParsed =
    envRaw && Number.isInteger(Number(envRaw)) ? Number(envRaw) : undefined;
  const stackNs = Number(stack.namespace);
  if (envParsed !== undefined && envParsed !== stackNs) {
    throw new SvmIngestRuntimeRefusalError(
      "svm_ingest_namespace_mismatch",
      `SVM ingest namespace mismatch: SVM_INGEST_NAMESPACE=${envParsed} ` +
        `COMMERCIAL_ACTIVE.namespace=${stackNs}`,
      { envKey: "SVM_INGEST_NAMESPACE" },
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

export function resolveCatchupMaxLagSlots(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = unsetEnv(env.SVM_INGEST_CATCHUP_MAX_LAG_SLOTS);
  if (!raw) return DEFAULT_CATCHUP_MAX_LAG_SLOTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SvmIngestRuntimeRefusalError(
      "invalid_catchup_max_lag_slots",
      "SVM_INGEST_CATCHUP_MAX_LAG_SLOTS must be a positive integer",
      { envKey: "SVM_INGEST_CATCHUP_MAX_LAG_SLOTS" },
    );
  }
  return parsed;
}

export function resolveIngestMaxRps(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = unsetEnv(env.SVM_INGEST_MAX_RPS);
  if (!raw) return DEFAULT_INGEST_MAX_RPS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new SvmIngestRuntimeRefusalError(
      "invalid_ingest_max_rps",
      "SVM_INGEST_MAX_RPS must be a positive number",
      { envKey: "SVM_INGEST_MAX_RPS" },
    );
  }
  return parsed;
}

export type SvmIngestRuntime = {
  rpcUrl: string;
  databaseUrl: string;
  stack: SvmCommercialActiveStack;
  namespace: number;
  startSlot: number;
  maxLagSlots: number;
  maxRps: number;
  port: number;
  followedPrograms: FollowedProgram[];
};

/**
 * Sole reader of `SOLANA_RPC_URL` for ingest + tooling (CLI binary-identity,
 * upgrade-in-place retention probes). Empty/whitespace counts as unset.
 * Does not invent a public Devnet default.
 */
export function resolveIngestSolanaRpcUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return unsetEnv(env.SOLANA_RPC_URL) ?? null;
}

/**
 * Sole runtime-config owner for svm-ingest: everything `main.ts` and the
 * deploy preflight need. Empty/whitespace env values count as unset.
 */
export function buildSvmIngestRuntime(
  env: NodeJS.ProcessEnv = process.env,
): SvmIngestRuntime {
  const rpcUrl = resolveIngestSolanaRpcUrl(env);
  if (!rpcUrl) {
    throw new SvmIngestRuntimeRefusalError(
      "missing_solana_rpc_url",
      "SOLANA_RPC_URL required for svm-ingest",
      { envKey: "SOLANA_RPC_URL" },
    );
  }

  const databaseUrl =
    unsetEnv(env.SVM_INGEST_DATABASE_URL) ?? unsetEnv(env.DATABASE_URL);
  if (!databaseUrl) {
    throw new SvmIngestRuntimeRefusalError(
      "missing_database_url",
      "SVM_INGEST_DATABASE_URL or DATABASE_URL required",
      { envKey: "SVM_INGEST_DATABASE_URL" },
    );
  }

  const stack = resolveIngestCommercialStack({ env });
  // Census gate: assertSvmCommercialStack via followedProgramsFromStack (one type).
  const followedPrograms = followedProgramsFromStack(stack);
  const port = Number(unsetEnv(env.SVM_INGEST_PORT) ?? "42100");

  return {
    rpcUrl,
    databaseUrl,
    stack,
    namespace: resolveIngestNamespace(stack),
    startSlot: resolveIngestStartSlot(stack),
    maxLagSlots: resolveCatchupMaxLagSlots(env),
    maxRps: resolveIngestMaxRps(env),
    port,
    followedPrograms,
  };
}
