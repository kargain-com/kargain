"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";

import { useNostrKey } from "@/hooks/use-nostr-key";
import { pubkeyFromPrivateKey } from "@/lib/nostr/app-event-store";
import {
  publishCommonsClaimProposal,
  type CommonsWmiProposalEntry,
} from "@/lib/nostr/commons-claims";
import { publishCommonsReview } from "@/lib/nostr/commons-reviews";
import {
  buildUnsignedCommonsReview,
  reviewSigningPayload,
  type CommonsReviewKind,
} from "@/lib/vincent-commons/review";
import { buildWmiClaim } from "@/lib/vincent-commons/wmi-claim";

const WMI_BUILD_ERROR_COPY: Record<string, string> = {
  "manufacturer-required": "Manufacturer is required.",
  "invalid-country": "Country must be a two-letter ISO 3166-1 code.",
  "unknown-region": "This WMI has no known region — the claim cannot be built.",
};

function wmiBuildErrorMessage(reason: string): string {
  return WMI_BUILD_ERROR_COPY[reason] ?? "The claim could not be built from these values.";
}

function isUserRejected(error: unknown): boolean {
  return error instanceof Error && /user rejected|user denied/i.test(error.message);
}

export type ProposalFormFields = {
  manufacturer: string;
  country: string;
  vehicleType: string;
};

export type ProposalSubmitOutcome = { ok: true } | { ok: false; message: string | null };

export type UseCommonsActionsReturn = {
  /** Optimistic own verdicts, rolled back on publish failure. */
  localVerdicts: Map<string, CommonsReviewKind>;
  /** Optimistic 31861 proposals, rolled back on publish failure. */
  localProposals: CommonsWmiProposalEntry[];
  pendingClaim: string | null;
  actionError: string | null;
  submitReview: (claim: string, kind: CommonsReviewKind) => Promise<void>;
  submitProposal: (
    wmi: string,
    fields: ProposalFormFields,
  ) => Promise<ProposalSubmitOutcome>;
};

/**
 * Signing orchestration for the KarPro Commons queue: wallet signature →
 * build → publish → optimistic state with rollback. One wallet signature per
 * action — a proposal signs only the endorse review over the claimHash; the
 * 31861 proposal itself is Nostr-only.
 */
export function useCommonsActions(address: `0x${string}`): UseCommonsActionsReturn {
  const { signMessageAsync } = useSignMessage();
  const { ensureNostrKey } = useNostrKey();

  const [localVerdicts, setLocalVerdicts] = useState<Map<string, CommonsReviewKind>>(
    new Map(),
  );
  const [localProposals, setLocalProposals] = useState<CommonsWmiProposalEntry[]>([]);
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

  return {
    localVerdicts,
    localProposals,
    pendingClaim,
    actionError,
    submitReview,
    submitProposal,
  };
}
