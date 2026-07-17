"use client";

import { Button } from "@/components/ui/button";
import { EnsWalletLink } from "@/components/ui/ens-wallet-link";
import {
  isAuctionAuthExpired,
  type AuctionAgentAuth,
} from "@/lib/auction/auction-agent";
import {
  endsAtDateTimeAttr,
  formatAuctionAmount,
} from "@/lib/auction/format-auction";
import { auctionAssetLabelFromAddress } from "@/lib/auction/owner-min-asset";

type Props = {
  authorization: AuctionAgentAuth;
  now: number;
  onManage: () => void;
};

function formatExpiry(expiry: bigint): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(Number(expiry) * 1000));
}

export function AuctionAgentAuthorizationStatus({
  authorization,
  now,
  onManage,
}: Props) {
  const assetLabel = auctionAssetLabelFromAddress(authorization.asset);
  const expired = isAuctionAuthExpired(authorization.expiry, now);

  return (
    <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-sans text-xs font-medium text-text-tertiary">
            Auction agent
          </p>
          <EnsWalletLink
            address={authorization.agent}
            className="font-mono text-sm"
          />
        </div>
        {expired && (
          <span className="shrink-0 rounded-sm border border-border-default px-2 py-1 font-mono text-[10.5px] text-text-tertiary">
            expired
          </span>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Minimum</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            Min{" "}
            {formatAuctionAmount(
              authorization.ownerMinAsset,
              assetLabel,
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Authorization</dt>
          <dd className="font-mono tabular-nums text-text-primary">
            {authorization.expiry === 0n ? (
              "No expiration"
            ) : (
              <time dateTime={endsAtDateTimeAttr(authorization.expiry)}>
                {formatExpiry(authorization.expiry)}
              </time>
            )}
          </dd>
        </div>
      </dl>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={onManage}
      >
        Manage
      </Button>
    </div>
  );
}
