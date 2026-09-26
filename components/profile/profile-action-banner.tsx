"use client";

import { UserCheckIcon, WarningIcon } from "@/components/ui/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useActiveAccount } from "@/hooks/use-active-account";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";
import { isEvmHexAddress } from "@/lib/passport/passport-owner";
import { admitSessionSurface, admitSurfaceAllowsEvmRead } from "@/lib/web3/surface-admission";
import { surfaceClassCCauseCopy } from "@/lib/web3/surface-support";

export type ProfileActionBannerProps = {
  isOwner: boolean;
  isConnected: boolean;
  subjectIsKarPro: boolean;
  subjectName: string;
  subjectWallet: string;
  /** From deriveOutstandingObligations — null while unresolved. */
  outstandingCount: number | null;
  outstandingHref: string;
};

export function ProfileActionBanner({
  isOwner,
  isConnected,
  subjectIsKarPro,
  subjectName,
  subjectWallet,
  outstandingCount,
  outstandingHref,
}: ProfileActionBannerProps) {
  const { account } = useActiveAccount();
  const messagingAdmission = admitSessionSurface(account, "messaging_session");
  const messagingAvailable = admitSurfaceAllowsEvmRead(messagingAdmission);
  const messagingPeer =
    !isOwner &&
    isConnected &&
    subjectIsKarPro &&
    messagingAvailable &&
    isEvmHexAddress(subjectWallet)
      ? subjectWallet
      : undefined;
  const { reachable, isLoading } = usePeerMessagingReachability(messagingPeer);

  if (!isOwner && isConnected && subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <UserCheckIcon size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Ask {subjectName} to verify your passport
        </p>
        {messagingAdmission.status === "family_required" ? (
          <p className="shrink-0 text-xs text-text-secondary" role="status">
            {surfaceClassCCauseCopy(messagingAdmission.capability)}
          </p>
        ) : isLoading ? null : reachable ? (
          <Button variant="secondary" size="sm" className="shrink-0" asChild>
            <Link href={`/messages?to=${subjectWallet}`}>Send request</Link>
          </Button>
        ) : (
          <p className="shrink-0 text-xs text-text-secondary" role="status">
            Messages not available
          </p>
        )}
      </div>
    );
  }

  if (!isOwner) {
    return null;
  }

  if (!subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <UserCheckIcon size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Join the trust network as a verified professional
        </p>
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href="/kar-pro">Become KarPro</Link>
        </Button>
      </div>
    );
  }

  if (outstandingCount != null && outstandingCount > 0) {
    const itemLabel = outstandingCount === 1 ? "item" : "items";
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <WarningIcon size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          {outstandingCount} outstanding {itemLabel} — deadlines, challenges, or
          standing bids run against this wallet.
        </p>
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href={outstandingHref}>View outstanding</Link>
        </Button>
      </div>
    );
  }

  return null;
}
