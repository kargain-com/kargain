"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type { Filter } from "nostr-tools";
import { useReadContracts } from "wagmi";

import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { COMMONS_CONFIRMATIONS_POLICY } from "@/lib/nostr/app-event-store";
import {
  commonsConfirmationEntryFromEvent,
  commonsConfirmationFilterForManifests,
} from "@/lib/nostr/commons-confirmations";
import { useLatestPerAuthorPerDEntries } from "@/lib/nostr/live-policy-subscription";
import { attestedPubkeysForAddresses } from "@/lib/nostr/resolve-attested-profile";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { commercialChainIds } from "@/lib/web3/chain-context";
import { wagmiChainId } from "@/lib/web3/supported-chains";

const ATTESTED_PUBKEYS_STALE_MS = 5 * 60 * 1000;

type UseCommonsConfirmationsOptions = {
  enabled?: boolean;
};

type UseCommonsConfirmationsReturn = {
  /**
   * manifestHash → attester addresses (lowercased, sorted) that passed every
   * gate: confirmation signature, attested wallet↔Nostr binding matching the
   * event author, and an `isActiveVerifier` chain read. Fail-closed —
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

  // One batched kind 31862 subscription; latest confirmation per
  // (author, manifest) via the shared latest-per-author-per-d merge.
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

  // Gate 1 — attested wallet↔Nostr binding: event author must equal the
  // attested pubkey for the stated attester address.
  const { data: attestedPubkeys, isPending: pubkeysPending } = useQuery({
    queryKey: ["commons-confirmation-attested-pubkeys", attesterKey],
    queryFn: () => attestedPubkeysForAddresses(attesters),
    enabled: attesters.length > 0,
    staleTime: ATTESTED_PUBKEYS_STALE_MS,
  });

  // Gate 2 — isActiveVerifier OR across commercial chains (wagmi-cached).
  const verifierContracts = useMemo(() => {
    const contracts: Array<{
      address: `0x${string}`;
      abi: typeof KarProStakingAbi;
      functionName: "isActiveVerifier";
      args: readonly [`0x${string}`];
      chainId: ReturnType<typeof wagmiChainId>;
    }> = [];
    for (const cid of commercialChainIds()) {
      const staking = karProStakingAddress(cid);
      if (!staking) continue;
      for (const attester of attesters) {
        contracts.push({
          address: staking,
          abi: KarProStakingAbi,
          functionName: "isActiveVerifier",
          args: [attester] as const,
          chainId: wagmiChainId(cid),
        });
      }
    }
    return contracts;
  }, [attesters]);

  const { data: verifierReads, isPending: verifierPending } = useReadContracts({
    contracts: verifierContracts,
    query: { enabled: verifierContracts.length > 0 },
  });

  const activeVerifierByAttester = useMemo(() => {
    const map = new Map<string, boolean>();
    const commercialCount = commercialChainIds().filter((cid) =>
      Boolean(karProStakingAddress(cid)),
    ).length;
    attesters.forEach((attester, attesterIndex) => {
      let active = false;
      for (let c = 0; c < commercialCount; c++) {
        const readIndex = c * attesters.length + attesterIndex;
        if (verifierReads?.[readIndex]?.result === true) {
          active = true;
          break;
        }
      }
      map.set(attester, active);
    });
    return map;
  }, [attesters, verifierReads]);

  const confirmationsByManifest = useMemo(() => {
    const result = new Map<string, string[]>();
    if (!attestedPubkeys) return result;

    for (const entry of entries) {
      const attester = entry.confirmation.attester.toLowerCase();
      // Fail closed: no attested profile, author mismatch, or inactive
      // verifier all exclude the confirmation from acceptance counts.
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
    (pubkeysPending || (verifierContracts.length > 0 && verifierPending));

  return {
    confirmationsByManifest,
    loading: subscriptionLoading || gatesLoading,
  };
}
