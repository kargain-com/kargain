"use client";

import {
  commercialNamespaceOf,
  useActiveAccount,
} from "@/hooks/use-active-account";

import Link from "next/link";

import { useActiveVerifierFact } from "@/hooks/use-active-verifier-fact";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { monoLinkSm } from "@/lib/design/instrument-classes";
import { activeMembershipChainIds } from "@/lib/kar-pro/membership-roster";
import type { KarProMembershipRow } from "@/lib/kar-pro/membership-roster";
import { karProSectionHref } from "@/lib/kar-pro/kar-pro-section-url";
import {
  commercialActive,
  nativeUnitOf,
} from "@/lib/web3/commercial-active";
import { admitSessionSurface, admitSurfaceAllowsEvmRead } from "@/lib/web3/surface-admission";
import { surfaceSupportCauseCopy } from "@/lib/web3/surface-support";
import { shortChainName } from "@/lib/web3/supported-chains";

type ProfileVerifierStatsBandProps = {
  membershipRows: readonly KarProMembershipRow[];
  isOwner: boolean;
};

/**
 * Owner-only stake readout when the session commercial namespace matches an
 * active membership. SVM names product_owner_owed for the stake amount.
 */
export function ProfileVerifierStatsBand({
  membershipRows,
  isOwner,
}: ProfileVerifierStatsBandProps) {
  const { account } = useActiveAccount();
  const ns = commercialNamespaceOf(account);
  const sessionNs = ns.ok ? Number(ns.namespace) : undefined;
  const { fact } = useActiveVerifierFact({ chainId: sessionNs ?? 0 });
  const activeIds = activeMembershipChainIds(membershipRows);
  const walletOnActive =
    sessionNs != null &&
    activeIds.includes(sessionNs) &&
    fact.kind === "active";
  const stakeAdmission = admitSessionSurface(account, "kar_pro_min_stake");
  const { stakeLabel, isPending } = useMinStakeNative(
    admitSurfaceAllowsEvmRead(stakeAdmission) ? sessionNs : undefined,
  );
  const stack = sessionNs != null ? commercialActive(sessionNs) : undefined;
  const unit = stack != null ? nativeUnitOf(stack) : null;

  if (!isOwner || !walletOnActive || sessionNs == null) {
    return null;
  }

  const amountLine =
    stakeAdmission.status === "support_refused"
      ? surfaceSupportCauseCopy(stakeAdmission.cause)
      : isPending
        ? null
        : unit != null
          ? `${stakeLabel} ${unit.symbol}`
          : stakeLabel;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border-default py-4">
      <span className="font-mono text-sm">
        {amountLine == null ? (
          <span
            className="inline-block h-4 w-16 animate-pulse rounded-sm bg-bg-surface"
            aria-hidden
          />
        ) : (
          <span className="font-medium text-text-primary">{amountLine}</span>
        )}
        {stakeAdmission.status !== "support_refused" ? (
          <span className="ml-1.5 text-text-secondary">
            staked on {shortChainName(sessionNs)}
          </span>
        ) : null}
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
