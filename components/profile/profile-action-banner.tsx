"use client";

import { UserCheckIcon, WarningIcon } from "@/components/ui/icons";
import Link from "next/link";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { usePeerMessagingReachability } from "@/hooks/use-peer-messaging-reachability";

export type ProfileActionBannerProps = {
  isOwner: boolean;
  isConnected: boolean;
  subjectIsKarPro: boolean;
  subjectName: string;
  subjectWallet: Address;
  openChallengeCount: number;
};

export function ProfileActionBanner({
  isOwner,
  isConnected,
  subjectIsKarPro,
  subjectName,
  subjectWallet,
  openChallengeCount,
}: ProfileActionBannerProps) {
  const { reachable, isLoading } = usePeerMessagingReachability(
    !isOwner && isConnected && subjectIsKarPro ? subjectWallet : undefined,
  );

  if (!isOwner && isConnected && subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <UserCheckIcon size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Ask {subjectName} to verify your passport
        </p>
        {isLoading ? null : reachable ? (
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

  if (openChallengeCount > 0) {
    const passportLabel = openChallengeCount === 1 ? "passport" : "passports";
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <WarningIcon size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          {openChallengeCount} {passportLabel} with open challenges on your
          verifications. You cannot resolve them — an independent KarPro must.
        </p>
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href="/challenges">View challenges</Link>
        </Button>
      </div>
    );
  }

  return null;
}
