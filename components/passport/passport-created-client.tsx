"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { usePassportIndexerPoll } from "@/hooks/use-passport-indexer-sync";

type Props = {
  tokenId: string;
  chainId: number;
};

export function PassportCreatedClient({ tokenId, chainId }: Props) {
  const router = useRouter();
  const { status } = usePassportIndexerPoll(tokenId, chainId);

  useEffect(() => {
    if (status === "matched") {
      router.replace(`/marketplace/${tokenId}?chain=${chainId}`);
    }
  }, [status, tokenId, chainId, router]);

  const isSyncing = status !== "matched";

  if (!isSyncing) return null;

  return (
    <p className="font-sans text-sm text-text-secondary" role="status">
      Syncing passport data…
    </p>
  );
}
