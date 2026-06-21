"use client";

import type { Address } from "viem";

import { IdentityHeader } from "@/components/identity/identity-header";

type Props = {
  wallet: Address;
  isActiveVerifier?: boolean;
  verifierName?: string | null;
  verifierCategory?: number;
  verificationCount?: number;
  stakeActiveSince?: number;
  proShowroomSlug?: string | null;
  showVerifierLink?: boolean;
  showProfileLink?: boolean;
};

export function ProfileHeaderIdentity({
  wallet,
  isActiveVerifier,
  verifierName,
  verifierCategory,
  verificationCount,
  stakeActiveSince,
  proShowroomSlug,
  showVerifierLink = true,
  showProfileLink = false,
}: Props) {
  return (
    <IdentityHeader
      wallet={wallet}
      karProName={verifierName ?? undefined}
      karProCategory={verifierCategory}
      isActiveVerifier={isActiveVerifier}
      verificationCount={verificationCount}
      stakeActiveSince={stakeActiveSince}
      proSlug={proShowroomSlug ?? undefined}
      showVerifierLink={showVerifierLink}
      showProfileLink={showProfileLink}
    />
  );
}
