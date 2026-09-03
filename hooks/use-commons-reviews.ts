"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type { Filter } from "nostr-tools";

import { useKarProMembershipActive } from "@/hooks/use-kar-pro-membership-active";
import { useNostrKey } from "@/hooks/use-nostr-key";
import { COMMONS_REVIEWS_POLICY } from "@/lib/nostr/app-event-store";
import {
  commonsReviewEntryFromEvent,
  commonsReviewFilterForClaims,
} from "@/lib/nostr/commons-reviews";
import { useLatestPerAuthorPerDEntries } from "@/lib/nostr/live-policy-subscription";
import { attestedPubkeysForAddresses } from "@/lib/nostr/resolve-attested-profile";
import type { CommonsReviewKind } from "@/lib/vincent-commons/review";

const ATTESTED_PUBKEYS_STALE_MS = 5 * 60 * 1000;

/** Verified reviewer addresses (lowercased) per claimHash. */
export type CommonsReviewTally = {
  endorsers: string[];
  rejecters: string[];
  /**
   * Endorser address → Nostr event author pubkey (gate 1 already enforces
   * the attested binding, so this is 1:1). F-2.1 proposer-endorse check.
   */
  endorserPubkeysByAddress: Record<string, string>;
};

type UseCommonsReviewsOptions = {
  enabled?: boolean;
};

type UseCommonsReviewsReturn = {
  /**
   * claimHash → tally of attesters that passed every gate: review signature,
   * attested wallet↔Nostr binding matching the event author, and KarPro
   * membership anyActive. Fail-closed — unresolved gates exclude.
   */
  verifiedByClaim: Map<string, CommonsReviewTally>;
  /** claimHash → connected wallet's own verdict (shown without count gating). */
  ownVerdictByClaim: Map<string, CommonsReviewKind>;
  loading: boolean;
};

function buildReviewFilter(subscriptionKey: string): Filter {
  return commonsReviewFilterForClaims(subscriptionKey.split(","));
}

export function useCommonsReviews(
  claimHashes: string[],
  options?: UseCommonsReviewsOptions,
): UseCommonsReviewsReturn {
  const enabled = options?.enabled ?? true;
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const address = evm.ok ? evm.address : undefined;
  const { nostrPubkey } = useNostrKey();

  const claimKey = useMemo(() => {
    const deduped = [...new Set(claimHashes)];
    deduped.sort();
    return deduped.join(",");
  }, [claimHashes]);

  const subscriptionKey = enabled && claimKey.length > 0 ? claimKey : "";

  // One batched kind 31860 subscription; latest review per (author, claim)
  // via the shared latest-per-author-per-d merge (d = claim on parse).
  const { entries, loading: subscriptionLoading } = useLatestPerAuthorPerDEntries(
    subscriptionKey,
    buildReviewFilter,
    COMMONS_REVIEWS_POLICY,
    commonsReviewEntryFromEvent,
  );

  const attesterKey = useMemo(() => {
    const deduped = [...new Set(entries.map((e) => e.review.attester.toLowerCase()))];
    deduped.sort();
    return deduped.join(",");
  }, [entries]);

  const attesters = useMemo(
    () => (attesterKey ? (attesterKey.split(",") as Address[]) : []),
    [attesterKey],
  );

  // Gate 1 — attested wallet↔Nostr binding: event author must equal the
  // attested pubkey for the stated attester address.
  const { data: attestedPubkeys, isPending: pubkeysPending } = useQuery({
    queryKey: ["commons-review-attested-pubkeys", attesterKey],
    queryFn: () => attestedPubkeysForAddresses(attesters),
    enabled: attesters.length > 0,
    staleTime: ATTESTED_PUBKEYS_STALE_MS,
  });

  // Gate 2 — KarPro anyActive via shared membership gate (not a local OR loop).
  const {
    activeByAddress: activeVerifierByAttester,
    isPending: verifierPending,
    hasContracts: hasVerifierContracts,
  } = useKarProMembershipActive(attesters);

  const verifiedByClaim = useMemo(() => {
    const result = new Map<string, CommonsReviewTally>();
    if (!attestedPubkeys) return result;

    for (const entry of entries) {
      const attester = entry.review.attester.toLowerCase();
      // Fail closed: no attested profile, author mismatch, or inactive
      // verifier all exclude the review from display counts.
      const boundPubkey = attestedPubkeys.get(attester);
      if (!boundPubkey || boundPubkey !== entry.authorPubkey) continue;
      if (activeVerifierByAttester.get(attester) !== true) continue;

      const tally = result.get(entry.review.claim) ?? {
        endorsers: [],
        rejecters: [],
        endorserPubkeysByAddress: {},
      };
      if (entry.review.kind === "endorse") {
        tally.endorsers.push(attester);
        tally.endorserPubkeysByAddress[attester] = entry.authorPubkey;
      } else {
        tally.rejecters.push(attester);
      }
      result.set(entry.review.claim, tally);
    }

    for (const tally of result.values()) {
      tally.endorsers.sort();
      tally.rejecters.sort();
    }
    return result;
  }, [entries, attestedPubkeys, activeVerifierByAttester]);

  const ownVerdictByClaim = useMemo(() => {
    const result = new Map<string, CommonsReviewKind>();
    if (!address || !nostrPubkey) return result;
    const own = address.toLowerCase();
    const ownPubkey = nostrPubkey.trim().toLowerCase();

    for (const entry of entries) {
      if (entry.review.attester.toLowerCase() !== own) continue;
      if (entry.authorPubkey.toLowerCase() !== ownPubkey) continue;
      result.set(entry.review.claim, entry.review.kind);
    }
    return result;
  }, [entries, address, nostrPubkey]);

  const gatesLoading =
    entries.length > 0 &&
    attesters.length > 0 &&
    (pubkeysPending || (hasVerifierContracts && verifierPending));

  return {
    verifiedByClaim,
    ownVerdictByClaim,
    loading: subscriptionLoading || gatesLoading,
  };
}
