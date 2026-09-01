/**
 * Commercial BPF program IDs for SVM raw ingest — from deploy evidence only.
 */

import type { SvmDevnetEvidence } from "./devnet-evidence.js";

/** Slug → evidence `programs` key (six production BPF programs). */
export const COMMERCIAL_PROGRAM_EVIDENCE_KEYS: Record<string, string> = {
  "kar-passport": "kar_passport",
  "kar-pro-staking": "kar_pro_staking",
  "kar-pro-pass": "kar_pro_pass",
  "kar-fixed-price": "kar_fixed_price",
  "kar-ascending": "kar_ascending",
  "kar-gateway": "kar_gateway",
};

export type FollowedProgram = {
  slug: string;
  programId: string;
  evidenceKey: string;
};

export function followedProgramsFromEvidence(
  evidence: SvmDevnetEvidence,
): FollowedProgram[] {
  const out: FollowedProgram[] = [];
  for (const [slug, evidenceKey] of Object.entries(COMMERCIAL_PROGRAM_EVIDENCE_KEYS)) {
    const row = evidence.programs[evidenceKey as keyof typeof evidence.programs];
    if (!row?.programId) continue;
    out.push({ slug, programId: row.programId, evidenceKey });
  }
  return out;
}

export function followedProgramIdSet(programs: readonly FollowedProgram[]): Set<string> {
  return new Set(programs.map((p) => p.programId));
}

export function resolveIngestStartSlot(evidence: SvmDevnetEvidence): number {
  const fromEvidence = evidence.indexFromSlot;
  if (typeof fromEvidence === "number" && Number.isInteger(fromEvidence) && fromEvidence >= 0) {
    return fromEvidence;
  }
  const legacy = evidence.slotAtEvidence;
  if (typeof legacy === "number" && Number.isInteger(legacy) && legacy >= 0) {
    return legacy;
  }
  const envRaw = process.env.SVM_INGEST_START_SLOT?.trim();
  if (envRaw) {
    const parsed = Number(envRaw);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new Error(
    "SVM ingest start slot unset — set indexFromSlot in deploy evidence or SVM_INGEST_START_SLOT",
  );
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
