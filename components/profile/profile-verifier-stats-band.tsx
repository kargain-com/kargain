"use client";

import { useActiveAccount, requireEvmSession } from "@/hooks/use-active-account";

import Link from "next/link";

import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { monoLinkSm } from "@/lib/design/instrument-classes";
import { activeMembershipChainIds } from "@/lib/kar-pro/membership-roster";
import type { KarProMembershipRow } from "@/lib/kar-pro/membership-roster";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { karProSectionHref } from "@/lib/kar-pro/kar-pro-section-url";
import { shortChainName } from "@/lib/web3/supported-chains";

type ProfileVerifierStatsBandProps = {
  membershipRows: readonly KarProMembershipRow[];
  isOwner: boolean;
};

/**
 * Owner-only stake readout when wallet commercial matches an active membership.
 * Public fee/count live on ProfileKarProNetworks — no OR + wallet fee collapse.
 */
export function ProfileVerifierStatsBand({
  membershipRows,
  isOwner,
}: ProfileVerifierStatsBandProps) {
  const { account } = useActiveAccount();
  const evm = requireEvmSession(account);
  const walletChainId = evm.ok ? evm.chainId : undefined;
  const chainId = resolveKarProTargetChainId(walletChainId);
  const activeIds = activeMembershipChainIds(membershipRows);
  const walletOnActive =
    chainId != null && activeIds.includes(chainId);
  const { stakeLabel } = useMinStakeNative(walletOnActive ? chainId : undefined);

  if (!isOwner || !walletOnActive || chainId == null) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border-default py-4">
      <span className="font-mono text-sm">
        <span className="font-medium text-text-primary">{stakeLabel} ETH</span>
        <span className="ml-1.5 text-text-secondary">
          staked on {shortChainName(chainId)}
        </span>
      </span>
      <Link href={karProSectionHref("membership")} className={monoLinkSm}>
        Manage →
      </Link>
      <Link href={karProSectionHref("fee")} className={monoLinkSm}>
        Edit fee →
      </Link>
    </div>
  );
}
