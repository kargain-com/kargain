"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { categoryLabel } from "@/lib/design/instrument-classes";
import {
  activeMembershipChainIds,
  type KarProMembershipRow,
} from "@/lib/kar-pro/membership-roster";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { karProSectionHref } from "@/lib/kar-pro/kar-pro-section-url";
import { shortChainName } from "@/lib/web3/supported-chains";

export type KarProStatusWidgetProps = {
  isOwner: boolean;
  isActiveVerifier: boolean;
  membershipRows: readonly KarProMembershipRow[];
};

export function KarProStatusWidget({
  isOwner,
  isActiveVerifier,
  membershipRows,
}: KarProStatusWidgetProps) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const chainId = resolveKarProTargetChainId(walletChainId);
  const activeIds = activeMembershipChainIds(membershipRows);
  const walletOnActive = chainId != null && activeIds.includes(chainId);
  const { stakeLabel } = useMinStakeNative(walletOnActive ? chainId : undefined);

  if (!isOwner || !isActiveVerifier) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border-default bg-bg-surface p-4">
      <div>
        <span className={categoryLabel}>KarPro status</span>
        {walletOnActive && chainId != null ? (
          <p className="mt-1 font-sans text-sm text-text-secondary">
            <span className="font-mono tabular-nums text-text-primary">{stakeLabel} ETH</span>
            {" staked on "}
            {shortChainName(chainId)}
            {" · Stake is fully refundable · No slash · No delay"}
          </p>
        ) : (
          <p className="mt-1 font-sans text-sm text-text-secondary">
            Active on another network — manage membership on KarPro hub.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
        {walletOnActive ? (
          <>
            <Link href={karProSectionHref("fee")}>
              <Button variant="ghost" size="sm">
                Edit fee →
              </Button>
            </Link>
            <Link href={karProSectionHref("membership")}>
              <Button variant="ghost" size="sm">
                Membership →
              </Button>
            </Link>
          </>
        ) : (
          <Link href="/kar-pro">
            <Button variant="ghost" size="sm">
              Manage on /kar-pro →
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
