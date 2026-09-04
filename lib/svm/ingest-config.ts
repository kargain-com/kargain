/**
 * Commercial BPF program IDs for SVM raw ingest — from deploy evidence only.
 * Six production programs (port plan §3.2). Missing any required key → named refusal.
 */

import type {
  SvmDevnetEvidence,
  SvmDevnetProgramEvidence,
} from "./devnet-evidence.js";

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

export type FollowedProgram = {
  slug: string;
  programId: string;
  evidenceKey: string;
};

export class MissingCommercialProgramError extends Error {
  readonly missingEvidenceKeys: readonly string[];

  constructor(missingEvidenceKeys: readonly string[]) {
    const list = missingEvidenceKeys.join(", ");
    super(
      `SVM ingest evidence missing required commercial program(s): ${list} — ` +
        `each of six needs programId + deploySlot; deploy FixedPrice + Ascending on Devnet (S9-0) before enabling svm-ingest`,
    );
    this.name = "MissingCommercialProgramError";
    this.missingEvidenceKeys = missingEvidenceKeys;
  }
}

function programRow(
  evidence: SvmDevnetEvidence,
  evidenceKey: CommercialProgramEvidenceKey,
): SvmDevnetProgramEvidence | undefined {
  return evidence.programs[evidenceKey];
}

function isValidDeploySlot(slot: unknown): slot is number {
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 0;
}

/**
 * Refuse incomplete commercial evidence by key name.
 * Requires programId and deploySlot on each of the six census keys.
 * Does not read `mock_staking`.
 */
export function assertSvmCommercialEvidence(evidence: SvmDevnetEvidence): void {
  const missing: string[] = [];
  for (const evidenceKey of COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST) {
    const row = programRow(evidence, evidenceKey);
    if (!row?.programId || !isValidDeploySlot(row.deploySlot)) {
      missing.push(evidenceKey);
    }
  }
  if (missing.length > 0) {
    throw new MissingCommercialProgramError(missing);
  }
}

/**
 * All six commercial programs must be present with a programId.
 * Silent skip of missing keys is forbidden (S9 research).
 * Never includes `mock_staking`.
 */
export function followedProgramsFromEvidence(
  evidence: SvmDevnetEvidence,
): FollowedProgram[] {
  assertSvmCommercialEvidence(evidence);
  const out: FollowedProgram[] = [];
  for (const [slug, evidenceKey] of Object.entries(COMMERCIAL_PROGRAM_EVIDENCE_KEYS)) {
    const row = programRow(evidence, evidenceKey)!;
    out.push({ slug, programId: row.programId, evidenceKey });
  }
  return out;
}

export function followedProgramIdSet(programs: readonly FollowedProgram[]): Set<string> {
  return new Set(programs.map((p) => p.programId));
}

/**
 * Follow cursor = minimum deploySlot over the six commercial programs.
 * No fallback to slotAtEvidence, indexFromSlot, or SVM_INGEST_START_SLOT.
 */
export function resolveIngestStartSlot(evidence: SvmDevnetEvidence): number {
  assertSvmCommercialEvidence(evidence);
  let min = Number.POSITIVE_INFINITY;
  for (const evidenceKey of COMMERCIAL_PROGRAM_EVIDENCE_KEY_LIST) {
    const slot = programRow(evidence, evidenceKey)!.deploySlot;
    if (slot < min) min = slot;
  }
  return min;
}

export function resolveIngestNamespace(evidence: SvmDevnetEvidence): number {
  const envRaw = process.env.SVM_INGEST_NAMESPACE?.trim();
  if (envRaw) {
    const parsed = Number(envRaw);
    if (Number.isInteger(parsed)) return parsed;
  }
  if (typeof evidence.namespace === "number") return evidence.namespace;
  throw new Error("SVM ingest namespace unset — evidence.namespace or SVM_INGEST_NAMESPACE");
}

export const DEFAULT_CATCHUP_MAX_LAG_SLOTS = 216_000;

export function resolveCatchupMaxLagSlots(): number {
  const raw = process.env.SVM_INGEST_CATCHUP_MAX_LAG_SLOTS?.trim();
  if (!raw) return DEFAULT_CATCHUP_MAX_LAG_SLOTS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("SVM_INGEST_CATCHUP_MAX_LAG_SLOTS must be a positive integer");
  }
  return parsed;
}
