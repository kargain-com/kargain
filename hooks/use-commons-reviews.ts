"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useAccount, useReadContracts } from "wagmi";

import { useNostrKey } from "@/hooks/use-nostr-key";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  applyCommonsReviewEvent,
  commonsReviewEntries,
  commonsReviewFilterForClaims,
  createEmptyCommonsReviewState,
  type CommonsReviewBatchState,
} from "@/lib/nostr/commons-reviews";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";
import { attestedPubkeysForAddresses } from "@/lib/nostr/resolve-attested-profile";
import type { CommonsReviewKind } from "@/lib/vincent-commons/review";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

const INITIAL_LOAD_TIMEOUT_MS = 3000;
const PROGRESSIVE_FLUSH_MS = 120;
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
   * attested wallet↔Nostr binding matching the event author, and an
   * `isActiveVerifier` chain read. Fail-closed — unresolved gates exclude.
   */
  verifiedByClaim: Map<string, CommonsReviewTally>;
  /** claimHash → connected wallet's own verdict (shown without count gating). */
  ownVerdictByClaim: Map<string, CommonsReviewKind>;
  loading: boolean;
};

function emptyState(): CommonsReviewBatchState {
  return createEmptyCommonsReviewState();
}

export function useCommonsReviews(
  claimHashes: string[],
  options?: UseCommonsReviewsOptions,
): UseCommonsReviewsReturn {
  const enabled = options?.enabled ?? true;
  const { address } = useAccount();
  const { nostrPubkey } = useNostrKey();

  const claimKey = useMemo(() => {
    const deduped = [...new Set(claimHashes)];
    deduped.sort();
    return deduped.join(",");
  }, [claimHashes]);

  const subscriptionKey = enabled && claimKey.length > 0 ? claimKey : "";

  const [state, setState] = useState<CommonsReviewBatchState>(emptyState);
  const [subscriptionLoading, setSubscriptionLoading] = useState(Boolean(subscriptionKey));

  const [prevSubscriptionKey, setPrevSubscriptionKey] = useState(subscriptionKey);
  if (subscriptionKey !== prevSubscriptionKey) {
    setPrevSubscriptionKey(subscriptionKey);
    setState(emptyState());
    setSubscriptionLoading(Boolean(subscriptionKey));
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

    const hashes = subscriptionKey.split(",");
    const pool = getNostrPool();
    const filter = commonsReviewFilterForClaims(hashes);

    let initialDone = false;
    let batchState = createEmptyCommonsReviewState();
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
        setSubscriptionLoading(false);
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
      setSubscriptionLoading(false);
    };

    const sub = pool.subscribeMany([...NOSTR_RELAYS], filter, {
      onevent: (ev) => {
        const next = applyCommonsReviewEvent(batchState, ev);
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

  const entries = useMemo(() => commonsReviewEntries(state), [state]);

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

  // Gate 2 — isActiveVerifier(attester) batch chain read (wagmi-cached).
  const staking = karProStakingAddress(DEFAULT_CHAIN_ID);
  const { data: verifierReads, isPending: verifierPending } = useReadContracts({
    contracts: staking
      ? attesters.map((attester) => ({
          address: staking,
          abi: KarProStakingAbi,
          functionName: "isActiveVerifier" as const,
          args: [attester] as const,
        }))
      : [],
    query: { enabled: Boolean(staking) && attesters.length > 0 },
  });

  const activeVerifierByAttester = useMemo(() => {
    const map = new Map<string, boolean>();
    attesters.forEach((attester, index) => {
      map.set(attester, verifierReads?.[index]?.result === true);
    });
    return map;
  }, [attesters, verifierReads]);

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
    (pubkeysPending || (Boolean(staking) && verifierPending));

  return {
    verifiedByClaim,
    ownVerdictByClaim,
    loading: subscriptionLoading || gatesLoading,
  };
}
