"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
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
  openDisputeCount: number;
  onTabChange: (tab: string) => void;
};

export function ProfileActionBanner({
  isOwner,
  isConnected,
  subjectIsKarPro,
  subjectName,
  subjectWallet,
  openDisputeCount,
  onTabChange,
}: ProfileActionBannerProps) {
  const { reachable, isLoading } = usePeerMessagingReachability(
    !isOwner && isConnected && subjectIsKarPro ? subjectWallet : undefined,
  );

  if (!isOwner && isConnected && subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <ShieldCheck size={20} strokeWidth={1.5} className="shrink-0 text-text-secondary" aria-hidden />
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
        <ShieldCheck size={20} strokeWidth={1.5} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Join the trust network as a verified professional
        </p>
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href="/kar-pro">Become KarPro</Link>
        </Button>
      </div>
    );
  }

  if (openDisputeCount > 0) {
    const passportLabel = openDisputeCount === 1 ? "passport" : "passports";
    return (
      <div className="flex items-center gap-4 rounded-md border border-border-default bg-bg-surface p-4">
        <AlertTriangle size={20} strokeWidth={1.5} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          {openDisputeCount} {passportLabel} awaiting your resolution
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => onTabChange("disputes")}
        >
          View disputes
        </Button>
      </div>
    );
  }

  return null;
}
