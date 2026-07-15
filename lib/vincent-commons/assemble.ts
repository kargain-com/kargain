/**
 * F-3a offline epoch-batch assembler (docs/research/vincent-flywheel.md
 * §4.3–§4.4, §10.1 F-3a refinement). Pure core: all I/O — relay queries,
 * attested kind 0 resolution, `isActiveVerifier` chain reads — is injected;
 * network code lives in scripts/vincent-assemble.ts.
 *
 * Adjudicated semantics (2026-07-15):
 *
 * - **Gate order per counted review — exactly the F-2 UI gates
 *   (hooks/use-commons-reviews.ts):** review signature verify
 *   (`commonsReviewFromEvent`) → gate 1 (the 31860 event author pubkey must
 *   equal the attested kind 0 pubkey for the stated attester — anti-replay:
 *   the wallet signature covers only {claim, attester, kind}, never the
 *   Nostr envelope, so without gate 1 an old signed endorse could be
 *   republished under a fresh Nostr key with a new created_at and override
 *   the attester's later reject) → gate 2 `isActiveVerifier` snapshot at
 *   assembly time. Fail-closed: an attester without an attested binding is
 *   not counted at all — surfaced report-only as `unattested-attester` when
 *   those accepts alone would have met the threshold (F-3c); NS-5.2 Nostr
 *   identity rotation invalidates that attester's standing verdicts until
 *   re-attestation (known consequence).
 *
 * - **tMet rule (deterministic reading of the §4.3 window):** tMet is the
 *   smallest `created_at` t such that the standing accepts (latest
 *   fully-gated verdict per attester) with `created_at ≤ t` satisfy the
 *   threshold rule — a chronological prefix walk over the current standing
 *   set; any verdict change recomputes everything. Late supporting accepts
 *   never delay publication. A claim is includable iff the threshold is met
 *   ∧ there is no standing reject ∧ `now ≥ tMet + windowDays·86400`.
 *
 * - **Future-clamp:** events with `created_at > now` are dropped before the
 *   latest-per-author-per-d merge — assembly sees only events that exist
 *   "as of now".
 *
 * - **Documented limitation:** `created_at` is client-set — colluding
 *   active verifiers can backdate accepts to burn through the window. Same
 *   threat model as flywheel §5 event 8 (advisory data + §4.4 client
 *   acceptance bar + competing publisher chains); relay first-seen
 *   hardening is P2 territory, not built here.
 */
import type { Event, Filter } from "nostr-tools";

import { canonicalize, claimHash, type Claim, type WmiClaim } from "@kargain/vincent/protocol";

import { mergeLatestPerAuthorPerD } from "@/lib/nostr/app-event-store";
import {
  commonsClaimProposalFilterForWmis,
  commonsWmiProposalEntryFromEvent,
  dedupeCommonsWmiProposalEntries,
  type CommonsWmiProposalEntry,
} from "@/lib/nostr/commons-claims";
import {
  commonsReviewFilterForClaims,
  commonsReviewEntryFromEvent,
  type CommonsReviewEntry,
} from "@/lib/nostr/commons-reviews";
import { sortClaimsForJsonl } from "@/lib/vincent-commons/claim-sort";
import {
  deriveClaims,
  type DeriveConflict,
  type DeriveDeps,
  type VincentObservation,
} from "@/lib/vincent-commons/derive-claims";
import {
  buildCommonsCandidates,
  candidateThreshold,
  type CommonsCandidate,
} from "@/lib/vincent-commons/queue";
import type { CommonsReview } from "@/lib/vincent-commons/review";
import {
  wmiProposalThreshold,
  type WmiProposalEndorser,
} from "@/lib/vincent-commons/wmi-claim";

export const SECONDS_PER_DAY = 86_400;

export type AssembleDeps = {
  /** One-shot relay query (kind 31860 by `#d`, kind 31861 by `#w`). */
  queryEvents: (filter: Filter) => Promise<Event[]>;
  /**
   * Gate 1 — newest attested kind 0 pubkey per lowercased wallet address
   * (null when no verified attestation exists).
   */
  attestedPubkeys: (addresses: string[]) => Promise<Map<string, string | null>>;
  /** Gate 2 — `isActiveVerifier` snapshot per lowercased wallet address. */
  isActiveVerifier: (addresses: string[]) => Promise<Map<string, boolean>>;
  /** Injectable offline WMI table lookup (tests); defaults to the bundled table. */
  lookupWmi?: DeriveDeps["lookupWmi"];
};

export type AssembleInput = {
  observations: readonly VincentObservation[];
  /** tokenId → verifier of record (lowercased), from the observations source. */
  verifierByTokenId: Record<string, string>;
  /** Assembly clock (unix seconds) — injected for deterministic runs. */
  nowSeconds: number;
  windowDays: number;
  /** claimHashes already in the published epoch — subtracted from output. */
  baselineHashes: ReadonlySet<string>;
  deps: AssembleDeps;
};

export type AssemblyExclusionReason =
  | "rejected"
  | "in-window"
  | "inactive-attester"
  | "unattested-attester"
  | "below-threshold";

export type AssemblyExclusion = {
  claimHash: string;
  claimType: "vds-pattern" | "wmi";
  reason: AssemblyExclusionReason;
  /** `rejected` — fully-gated standing rejecters (sorted). */
  rejecters?: string[];
  /** `in-window` — threshold-first-met time and seconds until inclusion. */
  tMet?: number;
  remainingSeconds?: number;
  /** `inactive-attester` — accepts that failed only the isActiveVerifier gate. */
  inactiveAttesters?: string[];
  /**
   * `unattested-attester` — accepts that failed only gate 1 (attested
   * wallet↔Nostr binding missing or mismatched). Report-only diagnostic so
   * verifiers can see why their verdicts did not count.
   */
  unattestedAttesters?: string[];
  /** `below-threshold` — counted standing accepts. */
  acceptCount?: number;
};

export type AssemblyAcceptedEntry = {
  claimHash: string;
  claimType: "vds-pattern" | "wmi";
  tMet: number;
  /** All fully-gated standing endorser addresses (sorted). */
  endorsers: string[];
};

export type AssemblyReport = {
  nowSeconds: number;
  windowDays: number;
  windowSeconds: number;
  counts: {
    observations: number;
    patternCandidates: number;
    wmiProposals: number;
    reviewEvents: number;
    countedReviews: number;
    accepted: {
      vdsSchema: number;
      vdsBinding: number;
      vdsPattern: number;
      wmi: number;
      total: number;
    };
  };
  accepted: AssemblyAcceptedEntry[];
  excluded: AssemblyExclusion[];
  /** Derive-level conflicts — both sides excluded before review (§4.3.5). */
  conflicts: DeriveConflict[];
  baseline: { published: number; subtracted: number };
};

export type ArchivedReview = {
  review: CommonsReview;
  eventId: string;
  authorPubkey: string;
  createdAt: number;
};

export type ArchivedProposal = {
  claim: WmiClaim;
  eventId: string;
  authorPubkey: string;
  createdAt: number;
};

export type AttestationArchiveEntry = {
  reviews: ArchivedReview[];
  proposal?: ArchivedProposal;
};

/** claimHash → permanent review provenance (uploaded to Arweave at publish). */
export type AttestationArchive = Record<string, AttestationArchiveEntry>;

export type AssemblyResult = {
  /** Accepted fact cores in canonical §7.2 order, baseline subtracted. */
  acceptedClaims: Claim[];
  archive: AttestationArchive;
  report: AssemblyReport;
};

/** Gated standing verdict — one per (claim, attester) after gate 1. */
type GatedVerdict = {
  entry: CommonsReviewEntry;
  attester: string;
};

type ClaimDecision =
  | { status: "accepted"; tMet: number; endorsers: string[] }
  | { status: "excluded"; exclusion: AssemblyExclusion };

function newerVerdict(a: CommonsReviewEntry, b: CommonsReviewEntry): CommonsReviewEntry {
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
  return a.eventId < b.eventId ? a : b;
}

/**
 * Standing verdicts per claim per attester for one gate tier. Gate 1 already
 * forces ≤1 author per attester, so this is defensive newest-wins dedupe.
 */
function standingVerdicts(
  entries: readonly CommonsReviewEntry[],
): Map<string, Map<string, CommonsReviewEntry>> {
  const byClaim = new Map<string, Map<string, CommonsReviewEntry>>();
  for (const entry of entries) {
    const attester = entry.review.attester.toLowerCase();
    const perAttester = byClaim.get(entry.review.claim) ?? new Map<string, CommonsReviewEntry>();
    const prev = perAttester.get(attester);
    perAttester.set(attester, prev ? newerVerdict(entry, prev) : entry);
    byClaim.set(entry.review.claim, perAttester);
  }
  return byClaim;
}

function sortedAccepts(perAttester: Map<string, CommonsReviewEntry> | undefined): GatedVerdict[] {
  if (!perAttester) return [];
  const accepts: GatedVerdict[] = [];
  for (const [attester, entry] of perAttester) {
    if (entry.review.kind === "endorse") accepts.push({ entry, attester });
  }
  accepts.sort((a, b) => {
    if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt - b.entry.createdAt;
    return a.entry.eventId < b.entry.eventId ? -1 : 1;
  });
  return accepts;
}

function standingRejecters(
  perAttester: Map<string, CommonsReviewEntry> | undefined,
): string[] {
  if (!perAttester) return [];
  const rejecters: string[] = [];
  for (const [attester, entry] of perAttester) {
    if (entry.review.kind === "reject") rejecters.push(attester);
  }
  return rejecters.sort();
}

/**
 * Prefix-walk decision shared by pattern and wmi claims. `thresholdMet`
 * evaluates the §4.3 / §10.2 rule on the accepts seen so far; tMet is the
 * created_at of the accept that first satisfies it.
 */
function decideClaim(options: {
  hash: string;
  claimType: "vds-pattern" | "wmi";
  gated: Map<string, CommonsReviewEntry> | undefined;
  inactiveAccepts: GatedVerdict[];
  unattestedAccepts: GatedVerdict[];
  thresholdMet: (accepts: readonly GatedVerdict[]) => boolean;
  nowSeconds: number;
  windowSeconds: number;
}): ClaimDecision {
  const {
    hash,
    claimType,
    gated,
    inactiveAccepts,
    unattestedAccepts,
    thresholdMet,
    nowSeconds,
    windowSeconds,
  } = options;

  const rejecters = standingRejecters(gated);
  if (rejecters.length > 0) {
    return {
      status: "excluded",
      exclusion: { claimHash: hash, claimType, reason: "rejected", rejecters },
    };
  }

  const accepts = sortedAccepts(gated);
  let tMet: number | null = null;
  for (let i = 0; i < accepts.length; i += 1) {
    if (thresholdMet(accepts.slice(0, i + 1))) {
      tMet = accepts[i].entry.createdAt;
      break;
    }
  }

  if (tMet === null) {
    // Diagnostic tier: would the threshold be met if accepts that failed
    // only the isActiveVerifier gate were counted?
    const wouldMeetInactive =
      inactiveAccepts.length > 0 && thresholdMet([...accepts, ...inactiveAccepts]);
    if (wouldMeetInactive) {
      return {
        status: "excluded",
        exclusion: {
          claimHash: hash,
          claimType,
          reason: "inactive-attester",
          inactiveAttesters: inactiveAccepts.map((a) => a.attester).sort(),
        },
      };
    }
    // Second diagnostic tier: would the threshold be met if accepts that
    // failed only gate 1 (attested binding) were counted? Report-only —
    // these accepts never count toward tMet, archive, or output.
    const countedAttesters = new Set(accepts.map((a) => a.attester));
    const unattestedOnly = unattestedAccepts.filter(
      (a) => !countedAttesters.has(a.attester),
    );
    const wouldMeetUnattested =
      unattestedOnly.length > 0 && thresholdMet([...accepts, ...unattestedOnly]);
    if (wouldMeetUnattested) {
      return {
        status: "excluded",
        exclusion: {
          claimHash: hash,
          claimType,
          reason: "unattested-attester",
          unattestedAttesters: unattestedOnly.map((a) => a.attester).sort(),
        },
      };
    }
    return {
      status: "excluded",
      exclusion: {
        claimHash: hash,
        claimType,
        reason: "below-threshold",
        acceptCount: accepts.length,
      },
    };
  }

  if (nowSeconds < tMet + windowSeconds) {
    return {
      status: "excluded",
      exclusion: {
        claimHash: hash,
        claimType,
        reason: "in-window",
        tMet,
        remainingSeconds: tMet + windowSeconds - nowSeconds,
      },
    };
  }

  return {
    status: "accepted",
    tMet,
    endorsers: accepts.map((a) => a.attester).sort(),
  };
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * Assemble the accepted community claim batch from VERIFIED observations and
 * the shared 31860/31861 review pool. Deterministic: identical inputs
 * (observations, events, gate maps, nowSeconds) produce byte-identical
 * serialized outputs.
 */
export async function assembleCommunityBatch(
  input: AssembleInput,
): Promise<AssemblyResult> {
  const { observations, verifierByTokenId, nowSeconds, windowDays, baselineHashes, deps } =
    input;
  const windowSeconds = windowDays * SECONDS_PER_DAY;

  // a. Derivation — candidate vds-pattern claims + sources + unknown WMIs.
  const { claims, report: deriveReport, sources } = await deriveClaims(
    observations,
    deps.lookupWmi ? { lookupWmi: deps.lookupWmi } : undefined,
  );
  const candidates = buildCommonsCandidates(claims, sources);
  const claimByHash = new Map<string, Claim>(
    claims.map((claim) => [claimHash(claim), claim]),
  );

  // b. Wmi proposals for derivation-surfaced unknown WMIs (F-2.1 scope).
  const unknownWmis = deriveReport.unknownWmiCandidates.map((c) => c.wmi);
  const unknownWmiSet = new Set(unknownWmis);
  let proposals: CommonsWmiProposalEntry[] = [];
  if (unknownWmis.length > 0) {
    const rawProposalEvents = await deps.queryEvents(
      commonsClaimProposalFilterForWmis(unknownWmis),
    );
    const merged = mergeLatestPerAuthorPerD(
      rawProposalEvents.filter((event) => event.created_at <= nowSeconds),
    );
    proposals = dedupeCommonsWmiProposalEntries(
      merged.map((event) => commonsWmiProposalEntryFromEvent(event)).filter(nonNull),
    ).filter((entry) => unknownWmiSet.has(entry.proposal.claim.key.wmi));
    proposals.sort((a, b) =>
      a.proposal.claimHash < b.proposal.claimHash ? -1 : 1,
    );
  }

  // c. Reviews for every candidate + proposal claimHash.
  const reviewTargets = [
    ...new Set([
      ...candidates.map((c) => c.claimHash),
      ...proposals.map((p) => p.proposal.claimHash),
    ]),
  ].sort();
  const targetSet = new Set(reviewTargets);

  let reviewEvents: Event[] = [];
  if (reviewTargets.length > 0) {
    reviewEvents = await deps.queryEvents(commonsReviewFilterForClaims(reviewTargets));
  }
  const reviewEntries = mergeLatestPerAuthorPerD(
    reviewEvents.filter((event) => event.created_at <= nowSeconds),
  )
    .map((event) => commonsReviewEntryFromEvent(event))
    .filter(nonNull)
    .filter((entry) => targetSet.has(entry.review.claim));

  // Gates 1 + 2 over the attester set (batched dep calls).
  const attesters = [
    ...new Set(reviewEntries.map((entry) => entry.review.attester.toLowerCase())),
  ].sort();
  const [attestedByAddress, activeByAddress] =
    attesters.length > 0
      ? await Promise.all([
          deps.attestedPubkeys(attesters),
          deps.isActiveVerifier(attesters),
        ])
      : [new Map<string, string | null>(), new Map<string, boolean>()];

  const gate1Entries: CommonsReviewEntry[] = [];
  const inactiveEntries: CommonsReviewEntry[] = [];
  const unattestedEntries: CommonsReviewEntry[] = [];
  for (const entry of reviewEntries) {
    const attester = entry.review.attester.toLowerCase();
    const boundPubkey = attestedByAddress.get(attester);
    if (!boundPubkey || boundPubkey !== entry.authorPubkey) {
      // Gate-1 failure — never counted; kept only for the report diagnostic.
      unattestedEntries.push(entry);
      continue;
    }
    if (activeByAddress.get(attester) === true) {
      gate1Entries.push(entry);
    } else {
      inactiveEntries.push(entry);
    }
  }

  const gatedByClaim = standingVerdicts(gate1Entries);
  const inactiveByClaim = standingVerdicts(inactiveEntries);
  const unattestedByClaim = standingVerdicts(unattestedEntries);

  const inactiveAcceptsFor = (hash: string): GatedVerdict[] =>
    sortedAccepts(inactiveByClaim.get(hash));
  const unattestedAcceptsFor = (hash: string): GatedVerdict[] =>
    sortedAccepts(unattestedByClaim.get(hash));

  // d. Threshold + window per claim.
  const acceptedEntries: AssemblyAcceptedEntry[] = [];
  const exclusions: AssemblyExclusion[] = [];
  const acceptedPatternHashes = new Set<string>();
  const acceptedWmiByHash = new Map<string, CommonsWmiProposalEntry>();

  const patternByHash = new Map<string, CommonsCandidate>(
    candidates.map((c) => [c.claimHash, c]),
  );
  for (const hash of [...patternByHash.keys()].sort()) {
    const candidate = patternByHash.get(hash);
    if (!candidate) continue;
    const decision = decideClaim({
      hash,
      claimType: "vds-pattern",
      gated: gatedByClaim.get(hash),
      inactiveAccepts: inactiveAcceptsFor(hash),
      unattestedAccepts: unattestedAcceptsFor(hash),
      thresholdMet: (accepts) =>
        candidateThreshold(
          candidate,
          verifierByTokenId,
          accepts.map((a) => a.attester),
        ).met,
      nowSeconds,
      windowSeconds,
    });
    if (decision.status === "accepted") {
      acceptedPatternHashes.add(hash);
      acceptedEntries.push({
        claimHash: hash,
        claimType: "vds-pattern",
        tMet: decision.tMet,
        endorsers: decision.endorsers,
      });
    } else {
      exclusions.push(decision.exclusion);
    }
  }

  for (const proposal of proposals) {
    const hash = proposal.proposal.claimHash;
    const toEndorsers = (accepts: readonly GatedVerdict[]): WmiProposalEndorser[] =>
      accepts.map((a) => ({ address: a.attester, pubkey: a.entry.authorPubkey }));
    const decision = decideClaim({
      hash,
      claimType: "wmi",
      gated: gatedByClaim.get(hash),
      inactiveAccepts: inactiveAcceptsFor(hash),
      unattestedAccepts: unattestedAcceptsFor(hash),
      thresholdMet: (accepts) =>
        wmiProposalThreshold(proposal.authorPubkey, toEndorsers(accepts)).met,
      nowSeconds,
      windowSeconds,
    });
    if (decision.status === "accepted") {
      acceptedWmiByHash.set(hash, proposal);
      acceptedEntries.push({
        claimHash: hash,
        claimType: "wmi",
        tMet: decision.tMet,
        endorsers: decision.endorsers,
      });
    } else {
      exclusions.push(decision.exclusion);
    }
  }

  acceptedEntries.sort((a, b) => (a.claimHash < b.claimHash ? -1 : 1));
  exclusions.sort((a, b) => (a.claimHash < b.claimHash ? -1 : 1));

  // e. Accepted set: patterns + their group's schema/binding declarations
  //    (only for groups with ≥1 accepted pattern — mirrors the F-1 rule) +
  //    accepted wmi claims, then baseline subtraction and §7.2 sort.
  const acceptedSchemaRefs = new Set<string>();
  for (const hash of acceptedPatternHashes) {
    const claim = claimByHash.get(hash);
    if (claim?.type === "vds-pattern") acceptedSchemaRefs.add(claim.key.schema);
  }

  const outputSet: Claim[] = [];
  for (const claim of claims) {
    if (claim.type === "vds-pattern") {
      if (acceptedPatternHashes.has(claimHash(claim))) outputSet.push(claim);
    } else if (claim.type === "vds-schema") {
      if (acceptedSchemaRefs.has(claimHash(claim))) outputSet.push(claim);
    } else if (claim.type === "vds-binding") {
      if (acceptedSchemaRefs.has(claim.key.schema)) outputSet.push(claim);
    }
  }
  for (const proposal of acceptedWmiByHash.values()) {
    outputSet.push(proposal.proposal.claim);
  }

  let subtracted = 0;
  const afterBaseline = outputSet.filter((claim) => {
    if (baselineHashes.has(claimHash(claim))) {
      subtracted += 1;
      return false;
    }
    return true;
  });
  const acceptedClaims = sortClaimsForJsonl(afterBaseline);

  // Archive: counted (fully-gated standing) reviews per accepted pattern/wmi
  // claim actually present in the output batch, plus the 31861 proposal
  // event for wmi claims. Schema/binding declarations follow their patterns
  // and carry no direct reviews.
  const outputHashes = new Set(acceptedClaims.map((claim) => claimHash(claim)));
  const archive: AttestationArchive = {};
  for (const entry of acceptedEntries) {
    if (!outputHashes.has(entry.claimHash)) continue;
    const perAttester = gatedByClaim.get(entry.claimHash);
    const reviews: ArchivedReview[] = [];
    if (perAttester) {
      for (const attester of [...perAttester.keys()].sort()) {
        const verdict = perAttester.get(attester);
        if (!verdict) continue;
        reviews.push({
          review: verdict.review,
          eventId: verdict.eventId,
          authorPubkey: verdict.authorPubkey,
          createdAt: verdict.createdAt,
        });
      }
    }
    const proposal = acceptedWmiByHash.get(entry.claimHash);
    archive[entry.claimHash] = proposal
      ? {
          reviews,
          proposal: {
            claim: proposal.proposal.claim,
            eventId: proposal.eventId,
            authorPubkey: proposal.authorPubkey,
            createdAt: proposal.createdAt,
          },
        }
      : { reviews };
  }

  const acceptedCounts = { vdsSchema: 0, vdsBinding: 0, vdsPattern: 0, wmi: 0 };
  for (const claim of acceptedClaims) {
    if (claim.type === "vds-schema") acceptedCounts.vdsSchema += 1;
    else if (claim.type === "vds-binding") acceptedCounts.vdsBinding += 1;
    else if (claim.type === "vds-pattern") acceptedCounts.vdsPattern += 1;
    else if (claim.type === "wmi") acceptedCounts.wmi += 1;
  }

  const report: AssemblyReport = {
    nowSeconds,
    windowDays,
    windowSeconds,
    counts: {
      observations: observations.length,
      patternCandidates: candidates.length,
      wmiProposals: proposals.length,
      reviewEvents: reviewEvents.length,
      countedReviews: gate1Entries.length,
      accepted: { ...acceptedCounts, total: acceptedClaims.length },
    },
    accepted: acceptedEntries,
    excluded: exclusions,
    conflicts: deriveReport.conflicts,
    baseline: { published: baselineHashes.size, subtracted },
  };

  return { acceptedClaims, archive, report };
}

/** JCS-canonical JSONL — one fact core per line, trailing newline when nonempty. */
export function serializeClaimsJsonl(claims: readonly Claim[]): string {
  const jsonl = claims.map((claim) => canonicalize(claim)).join("\n");
  return jsonl.length > 0 ? `${jsonl}\n` : "";
}

/** Deterministic archive JSON — entries already inserted in sorted-hash order. */
export function serializeAttestationArchive(archive: AttestationArchive): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function serializeAssemblyReport(report: AssemblyReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
