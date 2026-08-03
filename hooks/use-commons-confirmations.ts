"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type { Filter } from "nostr-tools";

import { useKarProMembershipActive } from "@/hooks/use-kar-pro-membership-active";
import { COMMONS_CONFIRMATIONS_POLICY } from "@/lib/nostr/app-event-store";
import {
  commonsConfirmationEntryFromEvent,
  commonsConfirmationFilterForManifests,
} from "@/lib/nostr/commons-confirmations";
import { useLatestPerAuthorPerDEntries } from "@/lib/nostr/live-policy-subscription";
import { attestedPubkeysForAddresses } from "@/lib/nostr/resolve-attested-profile";

const ATTESTED_PUBKEYS_STALE_MS = 5 * 60 * 1000;

type UseCommonsConfirmationsOptions = {
  enabled?: boolean;
};

type UseCommonsConfirmationsReturn = {
  /**
   * manifestHash → attester addresses (lowercased, sorted) that passed every
   * gate: confirmation signature, attested wallet↔Nostr binding matching the
   * event author, and KarPro membership anyActive. Fail-closed —
   * unresolved gates exclude. Self-confirmation exclusion (publisher of the
   * epoch) is the acceptance evaluator's concern, not this hook's.
   */
  confirmationsByManifest: Map<string, string[]>;
  loading: boolean;
};

function buildConfirmationFilter(subscriptionKey: string): Filter {
  return commonsConfirmationFilterForManifests(subscriptionKey.split(","));
}

/**
 * Gated kind 31862 epoch confirmations for a set of manifestHashes — the
 * F-4 acceptance-bar input. Same gating chain as `useCommonsReviews`.
 */
export function useCommonsConfirmations(
  manifestHashes: string[],
  options?: UseCommonsConfirmationsOptions,
): UseCommonsConfirmationsReturn {
  const enabled = options?.enabled ?? true;

  const manifestKey = useMemo(() => {
    const deduped = [...new Set(manifestHashes)];
    deduped.sort();
    return deduped.join(",");
  }, [manifestHashes]);

  const subscriptionKey = enabled && manifestKey.length > 0 ? manifestKey : "";

  const { entries, loading: subscriptionLoading } = useLatestPerAuthorPerDEntries(
    subscriptionKey,
    buildConfirmationFilter,
    COMMONS_CONFIRMATIONS_POLICY,
    commonsConfirmationEntryFromEvent,
  );

  const attesterKey = useMemo(() => {
    const deduped = [
      ...new Set(entries.map((e) => e.confirmation.attester.toLowerCase())),
    ];
    deduped.sort();
    return deduped.join(",");
  }, [entries]);

  const attesters = useMemo(
    () => (attesterKey ? (attesterKey.split(",") as Address[]) : []),
    [attesterKey],
  );

  const { data: attestedPubkeys, isPending: pubkeysPending } = useQuery({
    queryKey: ["commons-confirmation-attested-pubkeys", attesterKey],
    queryFn: () => attestedPubkeysForAddresses(attesters),
    enabled: attesters.length > 0,
    staleTime: ATTESTED_PUBKEYS_STALE_MS,
  });

  const {
    activeByAddress: activeVerifierByAttester,
    isPending: verifierPending,
    hasContracts: hasVerifierContracts,
  } = useKarProMembershipActive(attesters);

  const confirmationsByManifest = useMemo(() => {
    const result = new Map<string, string[]>();
    if (!attestedPubkeys) return result;

    for (const entry of entries) {
      const attester = entry.confirmation.attester.toLowerCase();
      const boundPubkey = attestedPubkeys.get(attester);
      if (!boundPubkey || boundPubkey !== entry.authorPubkey) continue;
      if (activeVerifierByAttester.get(attester) !== true) continue;

      const attesterList = result.get(entry.confirmation.manifest) ?? [];
      if (!attesterList.includes(attester)) attesterList.push(attester);
      result.set(entry.confirmation.manifest, attesterList);
    }

    for (const attesterList of result.values()) {
      attesterList.sort();
    }
    return result;
  }, [entries, attestedPubkeys, activeVerifierByAttester]);

  const gatesLoading =
    entries.length > 0 &&
    attesters.length > 0 &&
    (pubkeysPending || (hasVerifierContracts && verifierPending));

  return {
    confirmationsByManifest,
    loading: subscriptionLoading || gatesLoading,
  };
}
