/**
 * F-2 Commons queue row model (docs/research/vincent-flywheel.md §4.3).
 *
 * Candidates are the derived vds-pattern claims (attribute + value rows);
 * schema/binding declarations follow their patterns at epoch build (F-3).
 * Pure helpers — the KarPro Commons section supplies derivation output and
 * verified review tallies.
 */
import { claimHash, type Claim } from "@kargain/vincent/protocol";

import type { DeriveSources } from "@/lib/vincent-commons/derive-claims";

export type CommonsCandidate = {
  claimHash: string;
  wmi: string;
  year: number;
  vds: string;
  attribute: string;
  code: string;
  /** Contributing VERIFIED-passport tokenIds (sorted). */
  tokenIds: string[];
};

/** Pattern-claim rows in canonical §7.2 order, joined to (WMI, year) groups. */
export function buildCommonsCandidates(
  claims: readonly Claim[],
  sources: DeriveSources,
): CommonsCandidate[] {
  const groupBySchema = new Map<string, { wmi: string; year: number }>();
  for (const claim of claims) {
    if (claim.type === "vds-binding") {
      groupBySchema.set(claim.key.schema, {
        wmi: claim.key.wmi,
        year: claim.key.yearFrom,
      });
    }
  }

  const candidates: CommonsCandidate[] = [];
  for (const claim of claims) {
    if (claim.type !== "vds-pattern") continue;
    const hash = claimHash(claim);
    const group = groupBySchema.get(claim.key.schema);
    candidates.push({
      claimHash: hash,
      wmi: group?.wmi ?? "",
      year: group?.year ?? 0,
      vds: claim.key.match.vds,
      attribute: claim.value.attribute,
      code: claim.value.code,
      tokenIds: sources[hash]?.tokenIds ?? [],
    });
  }
  return candidates;
}

/** Verifier-of-record addresses (lowercased, deduped) for a candidate's sources. */
export function candidateRecordVerifiers(
  candidate: CommonsCandidate,
  verifierByTokenId: Record<string, string>,
): string[] {
  const verifiers = new Set<string>();
  for (const tokenId of candidate.tokenIds) {
    const verifier = verifierByTokenId[tokenId]?.trim().toLowerCase();
    if (verifier) verifiers.add(verifier);
  }
  return [...verifiers].sort();
}

/**
 * Priority order: candidates whose source passports the connected verifier
 * verified first, then the rest — stable within both groups.
 */
export function orderCommonsCandidates(
  candidates: readonly CommonsCandidate[],
  verifierByTokenId: Record<string, string>,
  connectedAddress: string | undefined,
): CommonsCandidate[] {
  if (!connectedAddress) return [...candidates];
  const own = connectedAddress.trim().toLowerCase();

  const mine: CommonsCandidate[] = [];
  const rest: CommonsCandidate[] = [];
  for (const candidate of candidates) {
    const isRecordVerifier = candidateRecordVerifiers(
      candidate,
      verifierByTokenId,
    ).includes(own);
    (isRecordVerifier ? mine : rest).push(candidate);
  }
  return [...mine, ...rest];
}

export type CommonsThreshold = {
  /** §4.3 review policy: 1 when a record verifier accepted, else 2 independent. */
  required: 1 | 2;
  met: boolean;
  /** An accepting reviewer is the verifier of record of a source passport. */
  recordVerifierAccepted: boolean;
};

/** Threshold state from verified endorser addresses (lowercased). */
export function candidateThreshold(
  candidate: CommonsCandidate,
  verifierByTokenId: Record<string, string>,
  endorsers: readonly string[],
): CommonsThreshold {
  const record = new Set(candidateRecordVerifiers(candidate, verifierByTokenId));
  const recordVerifierAccepted = endorsers.some((address) =>
    record.has(address.trim().toLowerCase()),
  );
  if (recordVerifierAccepted) {
    return { required: 1, met: true, recordVerifierAccepted: true };
  }
  return {
    required: 2,
    met: new Set(endorsers.map((a) => a.trim().toLowerCase())).size >= 2,
    recordVerifierAccepted: false,
  };
}
