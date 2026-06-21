"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Address } from "viem";

import { fetchNostrProfile, type NostrProfileData } from "@/lib/nostr/profile";

export interface UseNostrProfileReturn {
  profile: NostrProfileData | null;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

const noop = () => {};

export function useNostrProfile(walletAddress: Address | undefined): UseNostrProfileReturn {
  const [profile, setProfile] = useState<NostrProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [fetchCount, setFetchCount] = useState(0);
  const isInitialAttemptRef = useRef(true);
  const mountedRef = useRef(true);

  const refetch = useCallback(() => {
    setError(false);
    setFetchCount((n) => n + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      setProfile(null);
      setLoading(false);
      setError(false);
      isInitialAttemptRef.current = true;
      return;
    }

    setLoading(true);

    void fetchNostrProfile(walletAddress).then((result) => {
      if (!mountedRef.current) return;
      setProfile(result);
      if (result === null && isInitialAttemptRef.current) {
        setError(true);
      }
      setLoading(false);
      isInitialAttemptRef.current = false;
    });
  }, [walletAddress, fetchCount]);

  if (!walletAddress) {
    return { profile: null, loading: false, error: false, refetch: noop };
  }

  return { profile, loading, error, refetch };
}
