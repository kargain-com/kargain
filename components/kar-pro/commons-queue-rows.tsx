"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { SpinnerIcon } from "@/components/ui/icons";
import type { CommonsReviewTally } from "@/hooks/use-commons-reviews";
import {
  categoryLabel,
  monoLinkSm,
  trustStampBase,
  trustStampNeutral,
} from "@/lib/design/instrument-classes";
import type { CommonsWmiProposalEntry } from "@/lib/nostr/commons-claims";
import { formatPassportShortLabel } from "@/lib/passport/passport-token-id";
import { cn } from "@/lib/utils";
import type { CommonsCandidate } from "@/lib/vincent-commons/queue";
import type { CommonsReviewKind } from "@/lib/vincent-commons/review";
import { wmiProposalThreshold } from "@/lib/vincent-commons/wmi-claim";

const ATTRIBUTE_LABELS: Record<string, string> = {
  model: "Model",
  series: "Series",
  bodyType: "Body type",
  fuelType: "Fuel type",
  transmission: "Transmission",
  engine: "Engine",
};

export function attributeLabel(attribute: string): string {
  return ATTRIBUTE_LABELS[attribute] ?? attribute;
}

export const EMPTY_TALLY: CommonsReviewTally = {
  endorsers: [],
  rejecters: [],
  endorserPubkeysByAddress: {},
};

export function SourceLinks({ tokenIds }: { tokenIds: string[] }) {
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

function ReviewTallyLine({
  tally,
  verdict,
}: {
  tally: CommonsReviewTally;
  verdict: CommonsReviewKind | undefined;
}) {
  return (
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
  );
}

function ReviewVerdictButtons({
  claim,
  verdict,
  rowPending,
  disabled,
  onReview,
}: {
  claim: string;
  verdict: CommonsReviewKind | undefined;
  rowPending: boolean;
  disabled: boolean;
  onReview: (claim: string, kind: CommonsReviewKind) => Promise<void>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {verdict !== "endorse" && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => void onReview(claim, "endorse")}
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
          disabled={disabled}
          onClick={() => void onReview(claim, "reject")}
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
  );
}

export function CandidateRow({
  candidate,
  tally,
  verdict,
  thresholdHint,
  rowPending,
  anyPending,
  onReview,
}: {
  candidate: CommonsCandidate;
  tally: CommonsReviewTally;
  verdict: CommonsReviewKind | undefined;
  thresholdHint: string;
  rowPending: boolean;
  anyPending: boolean;
  onReview: (claim: string, kind: CommonsReviewKind) => Promise<void>;
}) {
  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className={categoryLabel}>{attributeLabel(candidate.attribute)}</p>
          <p className="font-mono text-fluid-sm text-text-primary">{candidate.code}</p>
        </div>
        <p className="font-mono text-xs tabular-nums text-text-secondary">
          {candidate.wmi} · {candidate.year} · VDS {candidate.vds}
        </p>
      </div>

      <SourceLinks tokenIds={candidate.tokenIds} />
      <ReviewTallyLine tally={tally} verdict={verdict} />
      <p className="font-sans text-xs text-text-secondary">{thresholdHint}</p>
      <ReviewVerdictButtons
        claim={candidate.claimHash}
        verdict={verdict}
        rowPending={rowPending}
        disabled={anyPending}
        onReview={onReview}
      />
    </li>
  );
}

export function ProposalRow({
  entry,
  tally,
  verdict,
  rowPending,
  anyPending,
  onReview,
}: {
  entry: CommonsWmiProposalEntry;
  tally: CommonsReviewTally;
  verdict: CommonsReviewKind | undefined;
  rowPending: boolean;
  anyPending: boolean;
  onReview: (claim: string, kind: CommonsReviewKind) => Promise<void>;
}) {
  const value = entry.proposal.claim.value;
  const threshold = wmiProposalThreshold(
    entry.authorPubkey,
    tally.endorsers.map((endorser) => ({
      address: endorser,
      pubkey: tally.endorserPubkeysByAddress[endorser] ?? "",
    })),
  );

  return (
    <li className="space-y-2 rounded-sm border border-border-default p-3">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <p className={categoryLabel}>Manufacturer</p>
          <p className="font-mono text-sm text-text-primary">{value.manufacturer}</p>
        </div>
        <div>
          <p className={categoryLabel}>Country</p>
          <p className="font-mono text-sm text-text-primary">{value.country ?? "—"}</p>
        </div>
        <div>
          <p className={categoryLabel}>Vehicle type</p>
          <p className="font-mono text-sm text-text-primary">
            {value.vehicleType ?? "—"}
          </p>
        </div>
      </div>

      <ReviewTallyLine tally={tally} verdict={verdict} />

      <p className="font-sans text-xs text-text-secondary">
        {threshold.met
          ? "Threshold met — the proposer and an independent accept"
          : "Needs the proposer and one independent accept"}
      </p>

      <ReviewVerdictButtons
        claim={entry.proposal.claimHash}
        verdict={verdict}
        rowPending={rowPending}
        disabled={anyPending}
        onReview={onReview}
      />
    </li>
  );
}
