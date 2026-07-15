"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { SpinnerIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCommonsReviews,
  type CommonsReviewTally,
} from "@/hooks/use-commons-reviews";
import { useCommonsWmiProposals } from "@/hooks/use-commons-wmi-proposals";
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
import { pubkeyFromPrivateKey } from "@/lib/nostr/app-event-store";
import {
  publishCommonsClaimProposal,
  type CommonsWmiProposalEntry,
} from "@/lib/nostr/commons-claims";
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
import { buildWmiClaim, wmiProposalThreshold } from "@/lib/vincent-commons/wmi-claim";

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

const EMPTY_TALLY: CommonsReviewTally = {
  endorsers: [],
  rejecters: [],
  endorserPubkeysByAddress: {},
};

const WMI_BUILD_ERROR_COPY: Record<string, string> = {
  "manufacturer-required": "Manufacturer is required.",
  "invalid-country": "Country must be a two-letter ISO 3166-1 code.",
  "unknown-region": "This WMI has no known region — the claim cannot be built.",
};

function wmiBuildErrorMessage(reason: string): string {
  return WMI_BUILD_ERROR_COPY[reason] ?? "The claim could not be built from these values.";
}

type ProposalFormFields = {
  manufacturer: string;
  country: string;
  vehicleType: string;
};

type ProposalSubmitOutcome = { ok: true } | { ok: false; message: string | null };

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

  const unknownWmiList = useMemo(
    () => (data ? data.report.unknownWmiCandidates.map((candidate) => candidate.wmi) : []),
    [data],
  );

  const { proposalsByWmi, loading: proposalsLoading } = useCommonsWmiProposals(
    unknownWmiList,
    { enabled: unknownWmiList.length > 0 },
  );

  // Optimistic 31861 proposals with rollback on publish failure.
  const [localProposals, setLocalProposals] = useState<CommonsWmiProposalEntry[]>([]);

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

  // WMI with the propose-from-document form open.
  const [proposeWmi, setProposeWmi] = useState<string | null>(null);

  /**
   * One wallet signature — the endorse review over the claimHash; the 31861
   * proposal itself is Nostr-only. Optimistic proposal row + own endorse
   * verdict, both rolled back when either publish fails.
   */
  const submitProposal = async (
    wmi: string,
    fields: ProposalFormFields,
  ): Promise<ProposalSubmitOutcome> => {
    const build = buildWmiClaim({ wmi, ...fields });
    if (!build.ok) {
      return { ok: false, message: wmiBuildErrorMessage(build.reason) };
    }

    const hash = build.hash;
    const previousVerdict = localVerdicts.get(hash);
    setActionError(null);
    setPendingClaim(hash);

    let optimistic: CommonsWmiProposalEntry | null = null;
    const rollback = () => {
      if (optimistic) {
        const added = optimistic;
        setLocalProposals((prev) => prev.filter((entry) => entry !== added));
      }
      setLocalVerdict(hash, previousVerdict);
    };

    try {
      const unsigned = buildUnsignedCommonsReview(hash, address, "endorse");
      const signature = await signMessageAsync({
        message: reviewSigningPayload(unsigned),
      });

      const nostrKey = await ensureNostrKey();
      if (!nostrKey) {
        return { ok: false, message: "Publishing the proposal failed. Try again." };
      }

      const entry: CommonsWmiProposalEntry = {
        proposal: { claim: build.claim, claimHash: hash },
        createdAt: Math.floor(Date.now() / 1000),
        eventId: "",
        authorPubkey: pubkeyFromPrivateKey(nostrKey),
      };
      optimistic = entry;
      setLocalProposals((prev) => [...prev, entry]);
      setLocalVerdict(hash, "endorse");

      const proposalOk = await publishCommonsClaimProposal(build.claim, nostrKey);
      const reviewOk = proposalOk
        ? await publishCommonsReview({ ...unsigned, signature }, nostrKey)
        : false;

      if (!proposalOk || !reviewOk) {
        rollback();
        return { ok: false, message: "Publishing the proposal failed. Try again." };
      }
      return { ok: true };
    } catch (error) {
      rollback();
      return {
        ok: false,
        message: isUserRejected(error) ? null : "Signing the proposal failed. Try again.",
      };
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
                          const value = entry.proposal.claim.value;
                          const tally = verifiedByClaim.get(hash) ?? EMPTY_TALLY;
                          const verdict =
                            localVerdicts.get(hash) ?? ownVerdictByClaim.get(hash);
                          const threshold = wmiProposalThreshold(
                            entry.authorPubkey,
                            tally.endorsers.map((endorser) => ({
                              address: endorser,
                              pubkey: tally.endorserPubkeysByAddress[endorser] ?? "",
                            })),
                          );
                          const rowPending = pendingClaim === hash;

                          return (
                            <li
                              key={hash}
                              className="space-y-2 rounded-sm border border-border-default p-3"
                            >
                              <div className="flex flex-wrap gap-x-6 gap-y-2">
                                <div>
                                  <p className={categoryLabel}>Manufacturer</p>
                                  <p className="font-mono text-sm text-text-primary">
                                    {value.manufacturer}
                                  </p>
                                </div>
                                <div>
                                  <p className={categoryLabel}>Country</p>
                                  <p className="font-mono text-sm text-text-primary">
                                    {value.country ?? "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className={categoryLabel}>Vehicle type</p>
                                  <p className="font-mono text-sm text-text-primary">
                                    {value.vehicleType ?? "—"}
                                  </p>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                <p className="font-mono text-xs tabular-nums text-text-secondary">
                                  {tally.endorsers.length} accepts ·{" "}
                                  {tally.rejecters.length} rejects
                                </p>
                                {verdict && (
                                  <span className={cn(trustStampBase, trustStampNeutral)}>
                                    {verdict === "endorse" ? "You accepted" : "You rejected"}
                                  </span>
                                )}
                              </div>

                              <p className="font-sans text-xs text-text-secondary">
                                {threshold.met
                                  ? "Threshold met — the proposer and an independent accept"
                                  : "Needs the proposer and one independent accept"}
                              </p>

                              <div className="flex flex-wrap gap-2">
                                {verdict !== "endorse" && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    disabled={pendingClaim != null}
                                    onClick={() => void submitReview(hash, "endorse")}
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
                                    onClick={() => void submitReview(hash, "reject")}
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
                    )}

                    {proposeWmi === candidate.wmi ? (
                      <ProposeWmiForm
                        wmi={candidate.wmi}
                        pending={pendingClaim != null}
                        onSubmit={(fields) => submitProposal(candidate.wmi, fields)}
                        onClose={() => setProposeWmi(null)}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pendingClaim != null}
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

/**
 * Inline propose-from-document form. The document itself is never uploaded
 * or described beyond the sighting confirmation (PII, PROTOCOL §4.7).
 */
function ProposeWmiForm({
  wmi,
  pending,
  onSubmit,
  onClose,
}: {
  wmi: string;
  pending: boolean;
  onSubmit: (fields: ProposalFormFields) => Promise<ProposalSubmitOutcome>;
  onClose: () => void;
}) {
  const [manufacturer, setManufacturer] = useState("");
  const [country, setCountry] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [sighted, setSighted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const canSubmit = manufacturer.trim().length > 0 && sighted && !pending;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setFormError(null);
    const outcome = await onSubmit({ manufacturer, country, vehicleType });
    if (outcome.ok) {
      onClose();
      return;
    }
    if (outcome.message) {
      setFormError(outcome.message);
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-3 rounded-sm border border-border-default p-3"
    >
      <p className={categoryLabel}>Propose from document</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-manufacturer-${wmi}`}>Manufacturer</Label>
          <Input
            id={`wmi-manufacturer-${wmi}`}
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
            placeholder="Legal manufacturer"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-country-${wmi}`}>Country</Label>
          <Input
            id={`wmi-country-${wmi}`}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            placeholder="e.g. DE"
            maxLength={2}
            className="font-mono uppercase"
            disabled={pending}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`wmi-vehicle-type-${wmi}`}>Vehicle type</Label>
          <Input
            id={`wmi-vehicle-type-${wmi}`}
            value={vehicleType}
            onChange={(event) => setVehicleType(event.target.value)}
            placeholder="e.g. Passenger car"
            disabled={pending}
          />
        </div>
      </div>

      <p className="font-sans text-xs text-text-secondary">
        Country is the two-letter ISO code. Country and vehicle type are optional.
      </p>

      <div className="flex items-start gap-2">
        <Checkbox
          id={`wmi-sighted-${wmi}`}
          checked={sighted}
          onCheckedChange={(checked) => setSighted(checked === true)}
          disabled={pending}
          className="mt-0.5"
        />
        <Label
          htmlFor={`wmi-sighted-${wmi}`}
          className="font-normal leading-snug text-text-secondary"
        >
          I have sighted a document for this WMI (CoC, registration, or type approval)
        </Label>
      </div>

      {formError && (
        <p role="alert" className="font-sans text-sm text-status-error">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={!canSubmit}>
          {pending ? (
            <SpinnerIcon size={16} className="animate-spin" />
          ) : (
            "Sign and publish"
          )}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
