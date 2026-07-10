"use client";

import Link from "next/link";

import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { monoLinkSm } from "@/lib/design/instrument-classes";
import { karProSectionHref } from "@/lib/kar-pro/kar-pro-section-url";
import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";
import type { NostrProfileData } from "@/lib/nostr/parse-profile-content";

import {
  VerificationFeeDisplay,
  VerificationPaymentChips,
} from "@/components/verifier/verification-fee-display";

type ProfileVerifierStatsBandProps = {
  wallet: `0x${string}`;
  isActiveVerifier: boolean;
  initialProfile: KarProVerifierProfile | null;
  isOwner: boolean;
  nostrProfile?: NostrProfileData | null;
};

function StatsSeparator() {
  return <span className="text-text-tertiary" aria-hidden>·</span>;
}

export function ProfileVerifierStatsBand({
  wallet,
  isActiveVerifier,
  initialProfile,
  isOwner,
  nostrProfile = null,
}: ProfileVerifierStatsBandProps) {
  const { profile: liveProfile } = useKarProVerifierProfile(wallet, {
    isActiveVerifier: isActiveVerifier || Boolean(initialProfile?.active),
    syncWhileMissing: isOwner,
  });
  const { stakeLabel } = useMinStakeNative();

  const profile = liveProfile ?? initialProfile;
  const verificationCount = profile?.verificationCount ?? 0;
  const verificationFee = profile?.verificationFee ?? 0n;
  const showBand =
    isActiveVerifier || verificationCount > 0 || Boolean(profile?.active);

  if (!showBand) {
    return null;
  }

  const memberSinceYear =
    profile?.joinedAt != null && profile.joinedAt > 0
      ? new Date(profile.joinedAt * 1000).getFullYear()
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-border-default py-4">
      <span className="font-mono text-sm">
        <span className="font-medium text-text-primary">{verificationCount}</span>
        <span className="ml-1.5 text-text-secondary">verifications</span>
      </span>
      {memberSinceYear != null && (
        <>
          <StatsSeparator />
          <span className="font-mono text-sm">
            <span className="text-text-secondary">Active since </span>
            <span className="font-medium text-text-primary">{memberSinceYear}</span>
          </span>
        </>
      )}
      <StatsSeparator />
      <span className="font-mono text-sm text-text-secondary">
        <VerificationFeeDisplay
          feeWei={verificationFee}
          prefix="Verification fee "
          primaryClassName="font-mono text-sm text-text-secondary tabular-nums"
        />
        {nostrProfile != null && (
          <span className="ml-2 inline-flex align-middle">
            <VerificationPaymentChips profile={nostrProfile} />
          </span>
        )}
      </span>
      {isOwner && isActiveVerifier && (
        <>
          <StatsSeparator />
          <span className="font-mono text-sm">
            <span className="font-medium text-text-primary">{stakeLabel} ETH</span>
            <span className="ml-1.5 text-text-secondary">staked</span>
          </span>
          <StatsSeparator />
          <Link href={karProSectionHref("membership")} className={monoLinkSm}>
            Manage →
          </Link>
          <StatsSeparator />
          <Link href={karProSectionHref("fee")} className={monoLinkSm}>
            Edit fee →
          </Link>
        </>
      )}
    </div>
  );
}
