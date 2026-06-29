"use client";

import { Info } from "lucide-react";

import { usePassportIndexerSync } from "@/hooks/use-passport-indexer-sync";

type Props = {
  tokenId: string;
  chainId: number;
};

export function PassportIndexerSyncBanner({ tokenId, chainId }: Props) {
  const { isSyncing } = usePassportIndexerSync(tokenId, chainId, true);

  if (!isSyncing) return null;

  return (
    <div
      className="flex gap-3 rounded-md border border-border-default bg-bg-surface p-4"
      role="status"
    >
      <Info size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
      <p className="font-sans text-sm text-text-secondary">
        Syncing passport history from the indexer…
      </p>
    </div>
  );
}
