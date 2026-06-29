"use client";

import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import type { KarProVerifierProfile } from "@/lib/verifier/verifier-profile-types";

type ProfileVerifierStatsBandProps = {
  wallet: `0x${string}`;
  isActiveVerifier: boolean;
  initialProfile: KarProVerifierProfile | null;
  isOwner: boolean;
};

function StatsSeparator() {
  return <span className="text-text-tertiary" aria-hidden>·</span>;
}

export function ProfileVerifierStatsBand({
  wallet,
  isActiveVerifier,
  initialProfile,
  isOwner,
}: ProfileVerifierStatsBandProps) {
  const { profile: liveProfile } = useKarProVerifierProfile(wallet, {
    isActiveVerifier: isActiveVerifier || Boolean(initialProfile?.active),
    syncWhileMissing: isOwner,
  });

  const profile = liveProfile ?? initialProfile;
  const verificationCount = profile?.verificationCount ?? 0;
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
      {isOwner && isActiveVerifier && (
        <>
          <StatsSeparator />
          <span className="font-mono text-sm">
            <span className="font-medium text-text-primary">0.05 ETH</span>
            <span className="ml-1.5 text-text-secondary">staked</span>
          </span>
        </>
      )}
    </div>
  );
}
