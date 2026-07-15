"use client";

import { useMemo } from "react";
import type { Filter } from "nostr-tools";

import { COMMONS_CLAIM_PROPOSALS_POLICY } from "@/lib/nostr/app-event-store";
import {
  commonsClaimProposalFilterForWmis,
  commonsWmiProposalEntryFromEvent,
  dedupeCommonsWmiProposalEntries,
  type CommonsWmiProposalEntry,
} from "@/lib/nostr/commons-claims";
import { useLatestPerAuthorPerDEntries } from "@/lib/nostr/live-policy-subscription";

type UseCommonsWmiProposalsOptions = {
  enabled?: boolean;
};

type UseCommonsWmiProposalsReturn = {
  /**
   * WMI → fail-closed parsed proposals (content-addressed; deduped by
   * claimHash across authors, earliest proposer attributed). Trust display
   * comes from the gated kind 31860 review counts, not from this map.
   */
  proposalsByWmi: Map<string, CommonsWmiProposalEntry[]>;
  loading: boolean;
};

function buildProposalFilter(subscriptionKey: string): Filter {
  return commonsClaimProposalFilterForWmis(subscriptionKey.split(","));
}

/** One batched kind 31861 subscription for the unknown-WMI list. */
export function useCommonsWmiProposals(
  wmis: string[],
  options?: UseCommonsWmiProposalsOptions,
): UseCommonsWmiProposalsReturn {
  const enabled = options?.enabled ?? true;

  const wmiKey = useMemo(() => {
    const deduped = [...new Set(wmis)];
    deduped.sort();
    return deduped.join(",");
  }, [wmis]);

  const subscriptionKey = enabled && wmiKey.length > 0 ? wmiKey : "";

  const { entries, loading } = useLatestPerAuthorPerDEntries(
    subscriptionKey,
    buildProposalFilter,
    COMMONS_CLAIM_PROPOSALS_POLICY,
    commonsWmiProposalEntryFromEvent,
  );

  const proposalsByWmi = useMemo(() => {
    const map = new Map<string, CommonsWmiProposalEntry[]>();
    for (const entry of dedupeCommonsWmiProposalEntries(entries)) {
      const wmi = entry.proposal.claim.key.wmi;
      const list = map.get(wmi) ?? [];
      list.push(entry);
      map.set(wmi, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.proposal.claimHash.localeCompare(b.proposal.claimHash);
      });
    }
    return map;
  }, [entries]);

  return { proposalsByWmi, loading };
}
