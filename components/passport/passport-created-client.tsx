"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { getPassportDetail } from "@/app/actions/passport-detail";
import {
  KAR_PRO_VERIFIER_POLL_INTERVAL_MS,
  KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS,
} from "@/lib/kar-pro/kar-pro-verifier-profile";

type Props = {
  tokenId: string;
  chainId: number;
};

export function PassportCreatedClient({ tokenId, chainId }: Props) {
  const router = useRouter();
  const pendingFetchCountRef = useRef(0);

  useEffect(() => {
    pendingFetchCountRef.current = 0;
  }, [tokenId, chainId]);

  const query = useQuery({
    queryKey: ["passport-created", tokenId, chainId],
    queryFn: async () => {
      const result = await getPassportDetail(tokenId, chainId);
      if (!result.ok || result.indexerPending) {
        pendingFetchCountRef.current += 1;
      } else {
        pendingFetchCountRef.current = 0;
      }
      return result;
    },
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.ok && !data.indexerPending) return false;
      if (pendingFetchCountRef.current >= KAR_PRO_VERIFIER_POLL_MAX_ATTEMPTS) return false;
      return KAR_PRO_VERIFIER_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (query.data?.ok && !query.data.indexerPending) {
      router.replace(`/marketplace/${tokenId}?chain=${chainId}`);
    }
  }, [query.data, tokenId, chainId, router]);

  const isSyncing =
    !query.data ||
    !query.data.ok ||
    query.data.indexerPending ||
    query.isFetching;

  if (!isSyncing) return null;

  return (
    <p className="font-sans text-sm text-text-secondary" role="status">
      Syncing passport data…
    </p>
  );
}
