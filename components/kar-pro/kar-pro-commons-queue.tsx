"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SpinnerIcon } from "@/components/ui/icons";
import { useCommonsReviews } from "@/hooks/use-commons-reviews";
import { useNostrKey } from "@/hooks/use-nostr-key";
import {
  getCommonsObservations,
  type CommonsObservationsResult,
} from "@/app/actions/vincent-commons";
import {
  categoryLabel,
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  monoLinkSm,
  serialLabel,
  trustStampBase,
  trustStampNeutral,
} from "@/lib/design/instrument-classes";
import { publishCommonsReview } from "@/lib/nostr/commons-reviews";
import { formatPassportShortLabel } from "@/lib/passport/passport-token-id";
import { cn } from "@/lib/utils";
import {
  deriveClaims,
  type DeriveReport,
  type DeriveSources,
} from "@/lib/vincent-commons/derive-claims";
import {
  buildCommonsCandidates,
  candidateRecordVerifiers,
  candidateThreshold,
  orderCommonsCandidates,
  type CommonsCandidate,
} from "@/lib/vincent-commons/queue";
import {
  buildUnsignedCommonsReview,
  reviewSigningPayload,
  type CommonsReviewKind,
} from "@/lib/vincent-commons/review";

const ATTRIBUTE_LABELS: Record<string, string> = {
  model: "Model",
  series: "Series",
  bodyType: "Body type",
  fuelType: "Fuel type",
  transmission: "Transmission",
  engine: "Engine",
};

function attributeLabel(attribute: string): string {
  return ATTRIBUTE_LABELS[attribute] ?? attribute;
}

type QueueData = CommonsObservationsResult & {
  report: DeriveReport;
  sources: DeriveSources;
  candidates: CommonsCandidate[];
};

function SourceLinks({ tokenIds }: { tokenIds: string[] }) {
  if (tokenIds.length === 0) return null;
  return (
    <p className="font-sans text-xs text-text-secondary">
      Sources:{" "}
      {tokenIds.map((tokenId, index) => (
        <span key={tokenId}>
          {index > 0 && " · "}
          <Link href={`/marketplace/${tokenId}`} className={monoLinkSm}>
            {formatPassportShortLabel(tokenId)}
          </Link>
        </span>
      ))}
    </p>
  );
}

function isUserRejected(error: unknown): boolean {
  return error instanceof Error && /user rejected|user denied/i.test(error.message);
}

export function KarProCommonsQueue({ address }: { address: `0x${string}` }) {
  const { signMessageAsync } = useSignMessage();
  const { ensureNostrKey } = useNostrKey();

  // Session-scoped derivation cache: fetch + derive once per session.
  const {
    data,
    isPending,
    isError,
    refetch,
  } = useQuery<QueueData>({
    queryKey: ["vincent-commons-queue"],
    queryFn: async () => {
      const input = await getCommonsObservations();
      const { claims, report, sources } = await deriveClaims(input.observations);
      return {
        ...input,
        report,
        sources,
        candidates: buildCommonsCandidates(claims, sources),
      };
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  const verifierByTokenId = data?.verifierByTokenId ?? {};

  const orderedCandidates = useMemo(
    () =>
      data
        ? orderCommonsCandidates(data.candidates, data.verifierByTokenId, address)
        : [],
    [data, address],
  );

  const claimHashes = useMemo(
    () => orderedCandidates.map((candidate) => candidate.claimHash),
    [orderedCandidates],
  );

  const {
    verifiedByClaim,
    ownVerdictByClaim,
    loading: reviewsLoading,
  } = useCommonsReviews(claimHashes, { enabled: claimHashes.length > 0 });

  // Optimistic own verdicts with rollback on publish failure.
  const [localVerdicts, setLocalVerdicts] = useState<Map<string, CommonsReviewKind>>(
    new Map(),
  );
  const [pendingClaim, setPendingClaim] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const setLocalVerdict = (claim: string, kind: CommonsReviewKind | undefined) => {
    setLocalVerdicts((prev) => {
      const next = new Map(prev);
      if (kind) {
        next.set(claim, kind);
      } else {
        next.delete(claim);
      }
      return next;
    });
  };

  const submitReview = async (claim: string, kind: CommonsReviewKind) => {
    setActionError(null);
    setPendingClaim(claim);
    const previous = localVerdicts.get(claim);

    try {
      const unsigned = buildUnsignedCommonsReview(claim, address, kind);
      const signature = await signMessageAsync({
        message: reviewSigningPayload(unsigned),
      });

      setLocalVerdict(claim, kind);

      const nostrKey = await ensureNostrKey();
      const ok = nostrKey
        ? await publishCommonsReview({ ...unsigned, signature }, nostrKey)
        : false;

      if (!ok) {
        setLocalVerdict(claim, previous);
        setActionError("Publishing the review failed. Try again.");
      }
    } catch (error) {
      setLocalVerdict(claim, previous);
      if (!isUserRejected(error)) {
        setActionError("Signing the review failed. Try again.");
      }
    } finally {
      setPendingClaim(null);
    }
  };

  if (isPending) {
    return (
      <div className="rounded-md border border-border-default bg-bg-card p-6">
        <p className="flex items-center gap-2 font-sans text-fluid-sm text-text-secondary">
          <SpinnerIcon size={16} className="animate-spin" />
          Deriving candidate claims from verified passports…
        </p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-3">
        <EmptyState
          variant="infrastructure"
          level="B"
          role="alert"
          title="The Commons queue is unavailable — the indexer or metadata fetch failed."
        />
        <Button type="button" variant="ghost" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const conflicts = data.report.conflicts;
  const unknownWmis = data.report.unknownWmiCandidates;
  const isEmpty =
    orderedCandidates.length === 0 && conflicts.length === 0 && unknownWmis.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        variant="content"
        level="B"
        title="No candidate claims yet"
        description="Candidates appear here as passports are verified. Derived claims are reviewed before they enter the Vincent Commons dataset."
      />
    );
  }

  const ownLower = address.toLowerCase();

  return (
    <div className="space-y-6">
      <p className="font-mono text-xs tabular-nums text-text-secondary">
        {orderedCandidates.length} candidates · {conflicts.length} conflicts ·{" "}
        {unknownWmis.length} unknown WMIs
        {reviewsLoading && " · syncing reviews…"}
      </p>

      {actionError && (
        <p role="alert" className="font-sans text-sm text-status-error">
          {actionError}
        </p>
      )}

      {orderedCandidates.length > 0 && (
        <section className="rounded-md border border-border-default bg-bg-card px-4 md:px-6">
          <ul className="divide-y divide-border-default">
            {orderedCandidates.map((candidate) => {
              const tally = verifiedByClaim.get(candidate.claimHash) ?? {
                endorsers: [],
                rejecters: [],
              };
              const verdict =
                localVerdicts.get(candidate.claimHash) ??
                ownVerdictByClaim.get(candidate.claimHash);
              const threshold = candidateThreshold(
                candidate,
                verifierByTokenId,
                tally.endorsers,
              );
              const isRecordVerifier = candidateRecordVerifiers(
                candidate,
                verifierByTokenId,
              ).includes(ownLower);
              const rowPending = pendingClaim === candidate.claimHash;

              let thresholdHint: string;
              if (threshold.met) {
                thresholdHint = threshold.recordVerifierAccepted
                  ? "Threshold met — accepted by the verifier of record"
                  : "Threshold met — 2 independent accepts";
              } else if (isRecordVerifier) {
                thresholdHint = "Needs 1 accept — you are the verifier of record";
              } else {
                thresholdHint =
                  "Needs 1 accept from the verifier of record, or 2 independent accepts";
              }

              return (
                <li key={candidate.claimHash} className="space-y-2 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div>
                      <p className={categoryLabel}>{attributeLabel(candidate.attribute)}</p>
                      <p className="font-mono text-fluid-sm text-text-primary">
                        {candidate.code}
                      </p>
                    </div>
                    <p className="font-mono text-xs tabular-nums text-text-secondary">
                      {candidate.wmi} · {candidate.year} · VDS {candidate.vds}
                    </p>
                  </div>

                  <SourceLinks tokenIds={candidate.tokenIds} />

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <p className="font-mono text-xs tabular-nums text-text-secondary">
                      {tally.endorsers.length} accepts · {tally.rejecters.length} rejects
                    </p>
                    {verdict && (
                      <span className={cn(trustStampBase, trustStampNeutral)}>
                        {verdict === "endorse" ? "You accepted" : "You rejected"}
                      </span>
                    )}
                  </div>

                  <p className="font-sans text-xs text-text-secondary">{thresholdHint}</p>

                  <div className="flex flex-wrap gap-2">
                    {verdict !== "endorse" && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pendingClaim != null}
                        onClick={() => void submitReview(candidate.claimHash, "endorse")}
                      >
                        {rowPending ? (
                          <SpinnerIcon size={16} className="animate-spin" />
                        ) : verdict === "reject" ? (
                          "Change to accept"
                        ) : (
                          "Accept"
                        )}
                      </Button>
                    )}
                    {verdict !== "reject" && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-status-error hover:bg-bg-surface hover:text-status-error"
                        disabled={pendingClaim != null}
                        onClick={() => void submitReview(candidate.claimHash, "reject")}
                      >
                        {rowPending ? (
                          <SpinnerIcon size={16} className="animate-spin" />
                        ) : verdict === "endorse" ? (
                          "Change to reject"
                        ) : (
                          "Reject"
                        )}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {conflicts.length > 0 && (
        <section className="space-y-3">
          <h3 className={serialLabel}>Conflicts — review needed</h3>
          {conflicts.map((conflict) => (
            <div
              key={`${conflict.wmi}-${conflict.year}-${conflict.vds}-${conflict.attribute}`}
              className={cn(elevatedAdvisoryPanel, "space-y-2")}
            >
              <p className={cn("font-mono text-xs tabular-nums", elevatedAdvisoryText)}>
                {conflict.wmi} · {conflict.year} · VDS {conflict.vds} ·{" "}
                {attributeLabel(conflict.attribute)}
              </p>
              <p className={cn("font-sans text-sm", elevatedAdvisoryText)}>
                Conflicting values: {conflict.values.join(" · ")}
              </p>
              <SourceLinks tokenIds={conflict.tokenIds} />
              <p className="font-sans text-xs text-text-secondary">
                Excluded from derived claims until the conflict is resolved. No accept
                action on conflicted rows.
              </p>
            </div>
          ))}
        </section>
      )}

      {unknownWmis.length > 0 && (
        <section className="space-y-3">
          <h3 className={serialLabel}>Unknown WMIs</h3>
          <div className="rounded-md border border-border-default bg-bg-card px-4 md:px-6">
            <ul className="divide-y divide-border-default">
              {unknownWmis.map((candidate) => (
                <li key={candidate.wmi} className="space-y-1 py-4">
                  <p className="font-mono text-fluid-sm tabular-nums text-text-primary">
                    {candidate.wmi}
                  </p>
                  {candidate.makes.length > 0 && (
                    <p className="font-sans text-sm text-text-secondary">
                      Observed makes: {candidate.makes.join(", ")}
                    </p>
                  )}
                  <SourceLinks tokenIds={candidate.tokenIds} />
                  <p className="font-sans text-xs text-text-secondary">
                    Document-based contribution arrives in a later iteration.
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
