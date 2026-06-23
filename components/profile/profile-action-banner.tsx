"use client";

import { AlertTriangle, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";

export type ProfileActionBannerProps = {
  isOwner: boolean;
  isConnected: boolean;
  isActiveVerifier: boolean;
  subjectIsKarPro: boolean;
  subjectName: string;
  subjectWallet: Address;
  openDisputeCount: number;
  onTabChange: (tab: string) => void;
};

function openWalletConnect(): void {
  document.querySelector<HTMLElement>("[data-wallet-trigger]")?.click();
}

export function ProfileActionBanner({
  isOwner,
  isConnected,
  subjectIsKarPro,
  subjectName,
  subjectWallet,
  openDisputeCount,
  onTabChange,
}: ProfileActionBannerProps) {
  if (isOwner && !subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-sm border border-border-default p-4">
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

  if (isOwner && subjectIsKarPro && openDisputeCount > 0) {
    const passportLabel = openDisputeCount === 1 ? "passport" : "passports";
    return (
      <div className="flex items-center gap-4 rounded-sm border border-border-default p-4">
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

  if (!isOwner && !isConnected && subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-sm border border-border-default p-4">
        <Wallet size={20} strokeWidth={1.5} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Connect your wallet to message and request verification
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={openWalletConnect}
        >
          Connect wallet
        </Button>
      </div>
    );
  }

  if (!isOwner && isConnected && subjectIsKarPro) {
    return (
      <div className="flex items-center gap-4 rounded-sm border border-border-default p-4">
        <ShieldCheck size={20} strokeWidth={1.5} className="shrink-0 text-text-secondary" aria-hidden />
        <p className="flex-1 font-sans text-sm font-normal text-text-secondary">
          Ask {subjectName} to verify your passport
        </p>
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href={`/messages?to=${subjectWallet}`}>Send request</Link>
        </Button>
      </div>
    );
  }

  return null;
}
