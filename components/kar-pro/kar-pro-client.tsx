"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";

import { fetchKarProVerifierProfile } from "@/app/actions/kar-pro-verifier";
import { KarProCredentialCard } from "@/components/kar-pro/kar-pro-credential-card";
import { KarProJoinForm } from "@/components/kar-pro/kar-pro-join-form";
import { WalletLoginButton } from "@/components/wallet-login-button";
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

  const {
    data: verifierProfile,
    isPending: profilePending,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["kar-pro-verifier", address],
    queryFn: () => fetchKarProVerifierProfile(address!),
    enabled: Boolean(address && isActiveVerifier),
  });

  const handleJoinSuccess = () => {
    void refetch().then((result) => {
      const active = result.data?.[0]?.result === true;
      onVerifierStatusChange?.(active);
      if (active) void refetchProfile();
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

  if (profilePending || !verifierProfile) {
    return (
      <div className={containerClass}>
        <div className="rounded-md border border-border-default bg-bg-card p-6">
          <p className="font-sans text-fluid-sm text-text-secondary">Loading your KarPro credential…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
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
    </div>
  );
}
