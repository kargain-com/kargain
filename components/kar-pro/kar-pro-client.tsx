"use client";

import { useAccount } from "wagmi";

import { KarProCommonsSection } from "@/components/kar-pro/kar-pro-commons-section";
import { KarProMembershipSection } from "@/components/kar-pro/kar-pro-membership-section";
import { KarProFeeSection } from "@/components/kar-pro/kar-pro-fee-section";
import { KarProIdentityStrip } from "@/components/kar-pro/kar-pro-identity-strip";
import { KarProJoinForm } from "@/components/kar-pro/kar-pro-join-form";
import { KarProNetworkPrompt } from "@/components/kar-pro/kar-pro-network-prompt";
import { KarProOverviewSection } from "@/components/kar-pro/kar-pro-overview-section";
import { KarProPaymentsSection } from "@/components/kar-pro/kar-pro-payments-section";
import { KarProProfileSection } from "@/components/kar-pro/kar-pro-profile-section";
import { KarProSectionNav } from "@/components/kar-pro/kar-pro-section-nav";
import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { useMessagingSession } from "@/hooks/use-messaging-session";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { messagingReadyForChecklist, needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { useKeyedReadContracts } from "@/lib/web3/keyed-multicall";
import { wagmiChainId } from "@/lib/web3/supported-chains";

export function KarProClient({
  embedded = false,
  onVerifierStatusChange,
}: {
  embedded?: boolean;
  onVerifierStatusChange?: (isActiveVerifier: boolean) => void;
}) {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const chainId = resolveKarProTargetChainId(walletChainId);

  const staking = chainId != null ? karProStakingAddress(chainId) : undefined;
  const wc = chainId != null ? wagmiChainId(chainId) : undefined;

  const stakingReads = useKeyedReadContracts({
    contracts: staking && wc != null && address
      ? [
          {
            key: "isActiveVerifier" as const,
            address: staking,
            abi: KarProStakingAbi,
            functionName: "isActiveVerifier" as const,
            args: [address] as const,
            chainId: wc,
          },
        ]
      : [],
    query: { enabled: Boolean(staking && address && chainId != null) },
  });

  const isActiveVerifier = stakingReads.get("isActiveVerifier") === true;
  const { snapshot } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);

  const {
    profile: verifierProfile,
    isLoading: profileLoading,
    isSyncing,
    refetch: refetchProfile,
  } = useKarProVerifierProfile(address, {
    isActiveVerifier,
    chainId,
    syncWhileMissing: true,
  });

  const handleJoinSuccess = () => {
    void stakingReads.refetch().then((result) => {
      const active = result.get("isActiveVerifier") === true;
      onVerifierStatusChange?.(active);
    });
  };

  const handleLeave = () => {
    void stakingReads.refetch().then((result) => {
      const active = result.get("isActiveVerifier") === true;
      onVerifierStatusChange?.(active);
    });
  };

  const containerClass = embedded
    ? "space-y-5 text-text-primary"
    : "mx-auto w-full max-w-lg space-y-8 text-text-primary";

  if (!isConnected) {
    return (
      <div className={containerClass}>
        <div className="space-y-3">
          <EmptyState
            variant="infrastructure"
            level="B"
            title="Connect your wallet to become a KarPro verifier."
          />
          <WalletLoginButton />
        </div>
      </div>
    );
  }

  if (chainId == null) {
    return (
      <div className={containerClass}>
        <KarProNetworkPrompt />
      </div>
    );
  }

  if (!staking) {
    return (
      <div className={containerClass}>
        <p className="font-sans text-fluid-sm text-text-secondary">
          Staking not configured for this chain.
        </p>
      </div>
    );
  }

  if (!isActiveVerifier) {
    return (
      <div className={containerClass}>
        <KarProJoinForm chainId={chainId} onSuccess={handleJoinSuccess} />
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className={containerClass}>
        <div className="rounded-md border border-border-default bg-bg-card p-6">
          <p className="font-sans text-fluid-sm text-text-secondary">Loading your KarPro credential…</p>
        </div>
      </div>
    );
  }

  if (!verifierProfile) {
    return (
      <div className={containerClass}>
        <div className="space-y-4 rounded-md border border-border-default bg-bg-card p-6">
          <p className="font-sans text-fluid-sm text-text-secondary">
            Profile sync is taking longer than expected.
          </p>
          <Button type="button" variant="ghost" onClick={() => void refetchProfile()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {needsMessagingCard && <MessagingSetupCard context="karpro" variant="full" />}
      <KarProIdentityStrip
        chainId={chainId}
        category={verifierProfile.category}
        name={verifierProfile.name}
        address={address!}
      />
      <KarProSectionNav
        overview={
          <KarProOverviewSection
            chainId={chainId}
            joinedAt={verifierProfile.joinedAt}
            verificationCount={verifierProfile.verificationCount}
            address={address!}
            name={verifierProfile.name}
            slug={verifierProfile.slug}
            messagingReady={messagingReadyForChecklist(snapshot)}
          />
        }
        profile={
          <KarProProfileSection
            chainId={chainId}
            category={verifierProfile.category}
            name={verifierProfile.name}
            slug={verifierProfile.slug}
            metadataURI={verifierProfile.metadataURI}
            address={address!}
            onUpdated={() => void refetchProfile()}
          />
        }
        fee={<KarProFeeSection chainId={chainId} address={address!} staking={staking} />}
        payments={<KarProPaymentsSection chainId={chainId} address={address!} />}
        commons={<KarProCommonsSection address={address!} />}
        membership={
          <KarProMembershipSection
            chainId={chainId}
            address={address!}
            onLeft={handleLeave}
          />
        }
      />
      {isSyncing && (
        <p className="font-sans text-fluid-sm text-text-secondary">
          Syncing verification stats…
        </p>
      )}
    </div>
  );
}
