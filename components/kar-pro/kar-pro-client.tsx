"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";

import { KarProCommonsSection } from "@/components/kar-pro/kar-pro-commons-section";
import { KarProMembershipSection } from "@/components/kar-pro/kar-pro-membership-section";
import { KarProFeeSection } from "@/components/kar-pro/kar-pro-fee-section";
import { KarProIdentityStrip } from "@/components/kar-pro/kar-pro-identity-strip";
import { KarProJoinForm } from "@/components/kar-pro/kar-pro-join-form";
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
import { messagingReadyForChecklist, needsMessagingSetupCard } from "@/lib/messaging/snapshot-ui";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

export function KarProClient({
  embedded = false,
  onVerifierStatusChange,
}: {
  embedded?: boolean;
  onVerifierStatusChange?: (isActiveVerifier: boolean) => void;
}) {
  const chainId = DEFAULT_CHAIN_ID;
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();

  const staking = karProStakingAddress(chainId);

  const { data: reads, refetch } = useReadContracts({
    contracts: staking
      ? [
          ...(address
            ? [
                {
                  address: staking,
                  abi: KarProStakingAbi,
                  functionName: "isActiveVerifier" as const,
                  args: [address] as const,
                },
              ]
            : []),
        ]
      : [],
    query: { enabled: Boolean(staking && address) },
  });

  const isActiveVerifier = (reads?.[0]?.result as boolean | undefined) === true;
  const { snapshot } = useMessagingSession();
  const needsMessagingCard = needsMessagingSetupCard(snapshot);

  const {
    profile: verifierProfile,
    isLoading: profileLoading,
    isSyncing,
    refetch: refetchProfile,
  } = useKarProVerifierProfile(address, {
    isActiveVerifier,
    syncWhileMissing: true,
  });

  const handleJoinSuccess = () => {
    void refetch().then((result) => {
      const active = result.data?.[0]?.result === true;
      onVerifierStatusChange?.(active);
      if (active && address) {
        void queryClient.invalidateQueries({ queryKey: ["kar-pro-verifier", address] });
      }
    });
  };

  const handleLeave = () => {
    void refetch().then((result) => {
      const active = result.data?.[0]?.result === true;
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
        <KarProJoinForm onSuccess={handleJoinSuccess} />
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
        category={verifierProfile.category}
        name={verifierProfile.name}
        address={address!}
      />
      <KarProSectionNav
        overview={
          <KarProOverviewSection
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
            category={verifierProfile.category}
            name={verifierProfile.name}
            slug={verifierProfile.slug}
            metadataURI={verifierProfile.metadataURI}
            address={address!}
            onUpdated={() => void refetchProfile()}
          />
        }
        fee={<KarProFeeSection address={address!} staking={staking} />}
        payments={<KarProPaymentsSection address={address!} />}
        commons={<KarProCommonsSection address={address!} />}
        membership={
          <KarProMembershipSection
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
