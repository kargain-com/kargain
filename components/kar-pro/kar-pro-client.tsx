"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";

import { KarProCredentialCard } from "@/components/kar-pro/kar-pro-credential-card";
import { KarProJoinForm } from "@/components/kar-pro/kar-pro-join-form";
import { MessagingSetupCard } from "@/components/messaging/messaging-setup-card";
import { Button } from "@/components/ui/button";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { useKarProVerifierProfile } from "@/hooks/use-kar-pro-verifier-profile";
import { useMessagingStatus } from "@/hooks/use-messaging-status";
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
  const { needsSetup } = useMessagingStatus();

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
        <p className="font-sans text-base text-text-secondary">
          Connect your wallet to become a KarPro verifier
        </p>
        <WalletLoginButton />
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
        <div className="rounded-md border border-border-default bg-bg-card p-6 space-y-4">
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
      {needsSetup && <MessagingSetupCard context="karpro" variant="full" />}
      <KarProCredentialCard
        category={verifierProfile.category}
        name={verifierProfile.name}
        slug={verifierProfile.slug}
        joinedAt={verifierProfile.joinedAt}
        verificationCount={verifierProfile.verificationCount}
        metadataURI={verifierProfile.metadataURI}
        address={address!}
        onUpdated={() => void refetchProfile()}
        onLeft={handleLeave}
      />
      {isSyncing && (
        <p className="font-sans text-fluid-sm text-text-secondary">
          Syncing verification stats…
        </p>
      )}
    </div>
  );
}
