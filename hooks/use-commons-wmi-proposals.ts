"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyCommonsWmiProposalEvent,
  commonsClaimProposalFilterForWmis,
  commonsWmiProposalEntries,
  createEmptyCommonsWmiProposalState,
  type CommonsWmiProposalBatchState,
  type CommonsWmiProposalEntry,
} from "@/lib/nostr/commons-claims";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

const INITIAL_LOAD_TIMEOUT_MS = 3000;
const PROGRESSIVE_FLUSH_MS = 120;

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

function emptyState(): CommonsWmiProposalBatchState {
  return createEmptyCommonsWmiProposalState();
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

  const [state, setState] = useState<CommonsWmiProposalBatchState>(emptyState);
  const [loading, setLoading] = useState(Boolean(subscriptionKey));

  const [prevSubscriptionKey, setPrevSubscriptionKey] = useState(subscriptionKey);
  if (subscriptionKey !== prevSubscriptionKey) {
    setPrevSubscriptionKey(subscriptionKey);
    setState(emptyState());
    setLoading(Boolean(subscriptionKey));
  }

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!subscriptionKey) return;

    const wmiList = subscriptionKey.split(",");
    const pool = getNostrPool();
    const filter = commonsClaimProposalFilterForWmis(wmiList);

    let initialDone = false;
    let batchState = createEmptyCommonsWmiProposalState();
    let progressiveTimer: ReturnType<typeof setTimeout> | null = null;

    const publishBatchState = () => {
      if (!mountedRef.current) return;
      setState(batchState);
    };

    const scheduleProgressiveFlush = () => {
      if (initialDone || progressiveTimer != null) return;
      progressiveTimer = setTimeout(() => {
        progressiveTimer = null;
        if (!mountedRef.current || initialDone) return;
        publishBatchState();
        setLoading(false);
      }, PROGRESSIVE_FLUSH_MS);
    };

    const finishInitialLoad = () => {
      if (!mountedRef.current || initialDone) return;
      initialDone = true;
      if (progressiveTimer != null) {
        clearTimeout(progressiveTimer);
        progressiveTimer = null;
      }
      publishBatchState();
      setLoading(false);
    };

    const sub = pool.subscribeMany([...NOSTR_RELAYS], filter, {
      onevent: (ev) => {
        const next = applyCommonsWmiProposalEvent(batchState, ev);
        if (next === batchState || !mountedRef.current) return;
        batchState = next;
        if (!initialDone) {
          scheduleProgressiveFlush();
        } else {
          publishBatchState();
        }
      },
      oneose: finishInitialLoad,
      onclose: () => {
        finishInitialLoad();
      },
    });

    const timeout = window.setTimeout(finishInitialLoad, INITIAL_LOAD_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
      if (progressiveTimer != null) clearTimeout(progressiveTimer);
      try {
        sub.close();
      } catch {
        // ignore
      }
    };
  }, [subscriptionKey]);

  const proposalsByWmi = useMemo(() => {
    const map = new Map<string, CommonsWmiProposalEntry[]>();
    for (const entry of commonsWmiProposalEntries(state)) {
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
  }, [state]);

  return { proposalsByWmi, loading };
}
