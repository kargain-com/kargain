"use client";

import Link from "next/link";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { agentProfileHref } from "@/lib/marketplace/agent-profile-href";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  agentAddress: `0x${string}`;
};

export function ListingAgentBuyerAttribution({ agentAddress }: Props) {
  const { displayName, isKarPro, isLoading } = usePeerIdentity(agentAddress);

  const { profile, isLoading: profileLoading } = useKarProVerifierProfile(agentAddress, {
    isActiveVerifier: isKarPro,
    syncWhileMissing: false,
  });

  const profileHref = agentProfileHref(profile?.slug, agentAddress);
  const karProName = profile?.name?.trim() || (isKarPro ? displayName : "");
  const profileResolved = isKarPro && Boolean(karProName);
  const identityLoading =
    isLoading || (isKarPro && profileLoading && !profile?.name?.trim());

  if (identityLoading) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">Sold by…</p>
        <div className="flex items-center gap-3">
          <IdentityAvatar address={agentAddress} size={40} alt="" />
          <p className="font-sans text-sm text-text-secondary">{navShortAddress(agentAddress)}</p>
        </div>
      </div>
    );
  }

  if (!profileResolved) {
    return (
      <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
        <p className="font-sans text-sm text-text-secondary">
          Sold by{" "}
          <Link
            href={`/profile/${agentAddress}`}
            className="text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
          >
            an agent
          </Link>{" "}
          on behalf of the owner
        </p>
        <div className="flex items-center gap-3">
          <IdentityAvatar address={agentAddress} size={40} alt="Agent" />
          <Link
            href={`/profile/${agentAddress}`}
            className="truncate font-sans text-sm font-medium text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
          >
            {navShortAddress(agentAddress)}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-bg-surface p-4">
      <p className="font-sans text-sm text-text-secondary">
        Sold by{" "}
        <Link
          href={profileHref}
          className="text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
        >
          {karProName}
        </Link>{" "}
        on behalf of the owner
      </p>
      <div className="flex items-center gap-3">
        <IdentityAvatar address={agentAddress} size={40} alt={karProName} />
        <div className="min-w-0">
          <Link
            href={profileHref}
            className="truncate font-sans text-sm font-medium text-text-primary underline-offset-2 hover:text-accent-warm hover:underline"
          >
            {karProName}
          </Link>
          <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-accent-warm">
            KarPro
          </p>
        </div>
      </div>
    </div>
  );
}
