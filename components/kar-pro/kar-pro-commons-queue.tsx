"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SpinnerIcon } from "@/components/ui/icons";
import {
  attributeLabel,
  CandidateRow,
  EMPTY_TALLY,
  ProposalRow,
  SourceLinks,
} from "@/components/kar-pro/commons-queue-rows";
import { ProposeWmiForm } from "@/components/kar-pro/propose-wmi-form";
import { useCommonsActions } from "@/hooks/use-commons-actions";
import { useCommonsReviews } from "@/hooks/use-commons-reviews";
import { useCommonsWmiProposals } from "@/hooks/use-commons-wmi-proposals";
import { getCommonsObservations } from "@/app/actions/vincent-commons";
import {
  elevatedAdvisoryPanel,
  elevatedAdvisoryText,
  serialLabel,
} from "@/lib/design/instrument-classes";
import type { CommonsWmiProposalEntry } from "@/lib/nostr/commons-claims";
import { cn } from "@/lib/utils";
import {
  deriveClaims,
  type DeriveReport,
  type DeriveSources,
} from "@/lib/vincent-commons/derive-claims";
import type { CommonsObservationsResult } from "@/lib/vincent-commons/observations-source";
import {
  buildCommonsCandidates,
  candidateRecordVerifiers,
  candidateThreshold,
  orderCommonsCandidates,
  type CommonsCandidate,
} from "@/lib/vincent-commons/queue";

type QueueData = CommonsObservationsResult & {
  report: DeriveReport;
  sources: DeriveSources;
  candidates: CommonsCandidate[];
};

async function loadQueueData(): Promise<QueueData> {
  const input = await getCommonsObservations();
  const { claims, report, sources } = await deriveClaims(input.observations);
  return {
    ...input,
    report,
    sources,
    candidates: buildCommonsCandidates(claims, sources),
  };
}

export function KarProCommonsQueue({ address }: { address: `0x${string}` }) {
  // Session-scoped derivation cache: fetch + derive once per session.
  const {
    data,
    isPending,
    isError,
    refetch,
  } = useQuery<QueueData>({
    queryKey: ["vincent-commons-queue"],
    queryFn: loadQueueData,
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

  const unknownWmiList = useMemo(
    () => (data ? data.report.unknownWmiCandidates.map((candidate) => candidate.wmi) : []),
    [data],
  );

  const { proposalsByWmi, loading: proposalsLoading } = useCommonsWmiProposals(
    unknownWmiList,
    { enabled: unknownWmiList.length > 0 },
  );

  const {
    localVerdicts,
    localProposals,
    pendingClaim,
    actionError,
    submitReview,
    submitProposal,
  } = useCommonsActions(address);

  const mergedProposalsByWmi = useMemo(() => {
    const map = new Map<string, CommonsWmiProposalEntry[]>();
    for (const [wmi, entries] of proposalsByWmi) {
      map.set(wmi, [...entries]);
    }
    for (const entry of localProposals) {
      const wmi = entry.proposal.claim.key.wmi;
      const list = map.get(wmi) ?? [];
      if (!list.some((e) => e.proposal.claimHash === entry.proposal.claimHash)) {
        list.push(entry);
      }
      map.set(wmi, list);
    }
    return map;
  }, [proposalsByWmi, localProposals]);

  const claimHashes = useMemo(() => {
    const hashes = orderedCandidates.map((candidate) => candidate.claimHash);
    for (const entries of mergedProposalsByWmi.values()) {
      for (const entry of entries) {
        hashes.push(entry.proposal.claimHash);
      }
    }
    return hashes;
  }, [orderedCandidates, mergedProposalsByWmi]);

  const {
    verifiedByClaim,
    ownVerdictByClaim,
    loading: reviewsLoading,
  } = useCommonsReviews(claimHashes, { enabled: claimHashes.length > 0 });

  // WMI with the propose-from-document form open.
  const [proposeWmi, setProposeWmi] = useState<string | null>(null);

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
  const anyPending = pendingClaim != null;

  return (
    <div className="space-y-6">
      <p className="font-mono text-xs tabular-nums text-text-secondary">
        {orderedCandidates.length} candidates · {conflicts.length} conflicts ·{" "}
        {unknownWmis.length} unknown WMIs
        {(reviewsLoading || proposalsLoading) && " · syncing reviews…"}
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
              const tally = verifiedByClaim.get(candidate.claimHash) ?? EMPTY_TALLY;
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
                <CandidateRow
                  key={candidate.claimHash}
                  candidate={candidate}
                  tally={tally}
                  verdict={verdict}
                  thresholdHint={thresholdHint}
                  rowPending={pendingClaim === candidate.claimHash}
                  anyPending={anyPending}
                  onReview={submitReview}
                />
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
              {unknownWmis.map((candidate) => {
                const proposals = mergedProposalsByWmi.get(candidate.wmi) ?? [];
                return (
                  <li key={candidate.wmi} className="space-y-3 py-4">
                    <div className="space-y-1">
                      <p className="font-mono text-fluid-sm tabular-nums text-text-primary">
                        {candidate.wmi}
                      </p>
                      {candidate.makes.length > 0 && (
                        <p className="font-sans text-sm text-text-secondary">
                          Observed makes: {candidate.makes.join(", ")}
                        </p>
                      )}
                      <SourceLinks tokenIds={candidate.tokenIds} />
                    </div>

                    {proposals.length > 0 && (
                      <ul className="space-y-3">
                        {proposals.map((entry) => {
                          const hash = entry.proposal.claimHash;
                          return (
                            <ProposalRow
                              key={hash}
                              entry={entry}
                              tally={verifiedByClaim.get(hash) ?? EMPTY_TALLY}
                              verdict={
                                localVerdicts.get(hash) ?? ownVerdictByClaim.get(hash)
                              }
                              rowPending={pendingClaim === hash}
                              anyPending={anyPending}
                              onReview={submitReview}
                            />
                          );
                        })}
                      </ul>
                    )}

                    {proposeWmi === candidate.wmi ? (
                      <ProposeWmiForm
                        wmi={candidate.wmi}
                        pending={anyPending}
                        onSubmit={(fields) => submitProposal(candidate.wmi, fields)}
                        onClose={() => setProposeWmi(null)}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={anyPending}
                        onClick={() => setProposeWmi(candidate.wmi)}
                      >
                        Propose from document
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
