"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";

import {
  applyProfileEvent,
  buildEthereumProfileFilter,
  createEmptyProfileBatchState,
  profileMapFromState,
  type ProfileBatchState,
} from "@/lib/nostr/batch-profiles";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";
import { getNostrPool, NOSTR_RELAYS } from "@/lib/nostr/nostr-client";

const INITIAL_LOAD_TIMEOUT_MS = 3000;
const PROGRESSIVE_FLUSH_MS = 120;

type UseNostrProfilesOptions = {
  enabled?: boolean;
};

type UseNostrProfilesReturn = {
  profiles: Map<string, NostrProfileData | null>;
  loading: boolean;
};

function emptyProfileMap(): Map<string, NostrProfileData | null> {
  return new Map();
}

export function useNostrProfiles(
  addresses: Address[],
  options?: UseNostrProfilesOptions,
): UseNostrProfilesReturn {
  const enabled = options?.enabled ?? true;

  const addressKey = useMemo(() => {
    const deduped = [...new Set(addresses.map((a) => a.toLowerCase()))];
    deduped.sort();
    return deduped.join(",");
  }, [addresses]);

  const [profiles, setProfiles] = useState<Map<string, NostrProfileData | null>>(emptyProfileMap);
  const [loading, setLoading] = useState(enabled && addressKey.length > 0);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || addressKey.length === 0) {
      setProfiles(emptyProfileMap());
      setLoading(false);
      return;
    }

    const parsedAddresses = addressKey.split(",") as Address[];
    setLoading(true);
    setProfiles(emptyProfileMap());

    const pool = getNostrPool();
    const filter = buildEthereumProfileFilter(parsedAddresses);

    let initialDone = false;
    let batchState: ProfileBatchState = createEmptyProfileBatchState();
    let progressiveTimer: ReturnType<typeof setTimeout> | null = null;

    const publishBatchState = () => {
      if (!mountedRef.current) return;
      setProfiles(profileMapFromState(batchState));
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
        if (!mountedRef.current) return;
        batchState = applyProfileEvent(batchState, ev);
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
  }, [addressKey, enabled]);

  return { profiles, loading };
}
