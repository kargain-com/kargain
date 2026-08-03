"use client";

import { useReadContract } from "wagmi";

import {
  VerificationFeeDisplay,
  VerificationPaymentChips,
} from "@/components/verifier/verification-fee-display";
import { VerificationPayButton } from "@/components/verifier/verification-payment-modal";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type ProShowroomVerificationFeeProps = {
  address: `0x${string}`;
  verifierName: string;
  ponderFeeWei: bigint;
  /** Showroom membership chain — sole fee/pay target (not wallet). */
  chainId: number;
};

export function ProShowroomVerificationFee({
  address,
  verifierName,
  ponderFeeWei,
  chainId,
}: ProShowroomVerificationFeeProps) {
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);

  const { data: chainFeeWei } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "verificationFee",
    args: [address],
    chainId: wc,
    query: { enabled: Boolean(staking && address) },
  });

  const effectiveFeeWei = chainFeeWei ?? ponderFeeWei;
  const { profile } = useNostrProfile(address);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <VerificationFeeDisplay
          feeWei={effectiveFeeWei}
          prefix="Verification fee "
          primaryClassName="font-mono text-sm text-text-secondary tabular-nums"
        />
        <VerificationPaymentChips profile={profile} />
      </span>

      {effectiveFeeWei > 0n && (
        <VerificationPayButton
          verifierAddress={address}
          verifierName={verifierName}
          feeWei={effectiveFeeWei}
          membershipChainId={chainId}
          variant="secondary"
          size="sm"
        />
      )}
    </div>
  );
}
