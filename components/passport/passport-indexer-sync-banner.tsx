"use client";

import { CircleInformationIcon } from "@/components/ui/icons";

import { usePassportIndexerSync } from "@/hooks/use-passport-indexer-sync";
import {
  EDIT_INDEXER_SYNC_HINT,
  INDEXER_SYNC_DETAIL_HINT,
} from "@/lib/passport/passport-flow-messages";

type Props = {
  tokenId: string;
  chainId: number;
  enabled?: boolean;
  variant?: "detail" | "edit";
};

export function PassportIndexerSyncBanner({
  tokenId,
  chainId,
  enabled = true,
  variant = "detail",
}: Props) {
  // Entity polling covers externally initiated indexing when no receipt block is known.
  const { isSyncing } = usePassportIndexerSync(tokenId, chainId, enabled);

  if (!isSyncing) return null;

  return (
    <div
      className="flex gap-3 rounded-md border border-border-default bg-bg-surface p-4"
      role="status"
    >
      <CircleInformationIcon size={18} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
      <p className="font-sans text-sm text-text-secondary">
        {variant === "edit" ? EDIT_INDEXER_SYNC_HINT : INDEXER_SYNC_DETAIL_HINT}
      </p>
    </div>
  );
}
