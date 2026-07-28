"use client";

import { usePathname } from "next/navigation";
import { useReadContract } from "wagmi";

import { KarProSetupChecklist } from "@/components/kar-pro/kar-pro-setup-checklist";
import { ProPassIdLabel } from "@/components/kar-pro/pro-pass-id-label";
import { VerificationFeeDisplay } from "@/components/verifier/verification-fee-display";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { useNostrProfile } from "@/hooks/use-nostr-profile";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import { instrumentReadoutPanel, monoLinkSm } from "@/lib/design/instrument-classes";
import { replaceKarProSectionUrl } from "@/lib/kar-pro/kar-pro-section-url";
import { deriveSetupChecklist } from "@/lib/kar-pro/setup-checklist";
import { proPassTokenIdFromAddress } from "@/lib/kar-pro/pro-pass-token-id";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";
import { explorerAddressUrl } from "@/lib/web3/wallet-account";

type KarProOverviewSectionProps = {
  chainId: number;
  passId?: bigint;
  joinedAt: number;
  verificationCount: number;
  address: `0x${string}`;
  name: string;
  slug: string;
  messagingReady: boolean;
};

function formatJoinedDate(timestamp: number): string {
  if (!timestamp) return "Unknown";
  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function KarProOverviewSection({
  chainId,
  passId,
  joinedAt,
  verificationCount,
  address,
  name,
  slug,
  messagingReady,
}: KarProOverviewSectionProps) {
  const pathname = usePathname();
  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const resolvedPassId = passId ?? proPassTokenIdFromAddress(address);
  const { stakeLabel } = useMinStakeNative(chainId);
  const { profile: nostrProfile } = useNostrProfile(address);

  const { data: onChainFee } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "verificationFee",
    args: [address],
    chainId: wc,
    query: { enabled: Boolean(staking && address) },
  });

  const feeWei = onChainFee ?? 0n;

  const checklist = deriveSetupChecklist({
    name,
    slug,
    feeWei,
    hasExplicitPaymentMethods: nostrProfile?.verifierPaymentMethods !== undefined,
    messagingReady,
  });

  const goToFee = () => {
    replaceKarProSectionUrl(pathname, window.location.search, "fee");
  };

  return (
    <div className="space-y-6">
      {!checklist.allRequiredComplete && <KarProSetupChecklist checklist={checklist} />}
      <section className={`${instrumentReadoutPanel} space-y-4`}>
      <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-warm">
        ✓ Active KarPro
      </p>

      <div className="space-y-1">
        <p className="font-mono text-fluid-sm text-text-secondary">
          Pass{" "}
          <ProPassIdLabel
            tokenId={resolvedPassId}
            chainId={chainId}
            prefix="none"
            showChain={true}
            variant="mono"
            className="text-fluid-sm"
          />
        </p>
        <p className="font-mono text-fluid-sm tabular-nums text-text-primary">
          {stakeLabel} ETH staked
        </p>
      </div>

      <p className="font-sans text-fluid-sm text-text-secondary">
        Fully refundable after leave · No slash · Leave anytime
      </p>

      <p className="font-sans text-fluid-sm text-text-secondary">
        {verificationCount} verification{verificationCount === 1 ? "" : "s"} · Joined{" "}
        {formatJoinedDate(joinedAt)}
      </p>

      {staking && (
        <p className="font-sans text-fluid-sm text-text-secondary">
          <a
            href={explorerAddressUrl(chainId, staking)}
            target="_blank"
            rel="noopener noreferrer"
            className={monoLinkSm}
          >
            View staking contract
          </a>
        </p>
      )}

      <div className="space-y-1 border-t border-border-default pt-4">
        <p className="font-sans text-xs text-text-tertiary">Verification fee</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <VerificationFeeDisplay feeWei={feeWei} />
          <button
            type="button"
            onClick={goToFee}
            className={monoLinkSm}
          >
            Edit fee →
          </button>
        </div>
      </div>
    </section>
    </div>
  );
}
