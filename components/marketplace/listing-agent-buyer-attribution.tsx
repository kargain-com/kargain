"use client";

import Link from "next/link";

import { IdentityAvatar } from "@/components/identity/identity-avatar";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { usePeerIdentity } from "@/hooks/use-peer-identity";
import { categoryLabel } from "@/lib/design/instrument-classes";
import { agentProfileHref } from "@/lib/marketplace/agent-profile-href";
import { navShortAddress } from "@/lib/web3/wallet-display";

type Props = {
  agentAddress: `0x${string}`;
  chainId: number;
};

export function ListingAgentBuyerAttribution({ agentAddress, chainId }: Props) {
  const { displayName, isKarPro, isLoading } = usePeerIdentity(agentAddress, { chainId });

  const { profile, isLoading: profileLoading } = useKarProVerifierProfile(agentAddress, {
    isActiveVerifier: isKarPro,
    chainId,
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
          <p className="font-mono text-sm text-text-secondary">{navShortAddress(agentAddress)}</p>
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
            className="truncate font-mono text-sm text-text-secondary underline-offset-2 hover:text-accent-warm focus-visible:text-accent-warm hover:underline"
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
          <p className={categoryLabel}>
            KarPro
          </p>
        </div>
      </div>
    </div>
  );
}
