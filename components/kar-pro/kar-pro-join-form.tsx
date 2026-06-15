"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import {
  KarProProfileFields,
  type KarProProfileFieldValues,
} from "@/components/kar-pro/kar-pro-profile-fields";
import { Button } from "@/components/ui/button";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  categoryIndexToLabel,
  uploadKarProMetadata,
} from "@/lib/kar-pro/kar-pro-metadata";
import { getWalletUploadProvider } from "@/lib/passport/upload-passport-metadata";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

type LoadingPhase = "idle" | "uploading" | "confirming";

function formatStakeEth(wei: bigint | undefined): string {
  if (wei === undefined) return "0.05";
  const formatted = formatEther(wei);
  const num = Number.parseFloat(formatted);
  return Number.isFinite(num) ? num.toFixed(2) : formatted;
}

export function KarProJoinForm({ onSuccess }: { onSuccess: () => void }) {
  const chainId = DEFAULT_CHAIN_ID;
  const config = useConfig();
  const { connector } = useAccount();
  const walletChain = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState<KarProProfileFieldValues>({
    categoryIndex: 0,
    name: "",
    description: "",
    website: "",
  });
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = walletChain !== chainId;

  const { data: minStake } = useReadContract({
    address: staking,
    abi: KarProStakingAbi,
    functionName: "minStakeNative",
    query: { enabled: Boolean(staking) },
  });

  const stakeLabel = formatStakeEth(minStake);
  const isBusy = loadingPhase !== "idle";

  const onContinue = () => {
    if (!fields.name.trim()) {
      setError("Enter a display name.");
      return;
    }
    setError(null);
    setStep(2);
  };

  const onStake = async () => {
    if (!staking || !fields.name.trim()) return;
    setError(null);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });

      setLoadingPhase("uploading");
      const provider = await getWalletUploadProvider(connector ?? undefined);
      const metadataUri = await uploadKarProMetadata(
        {
          categoryIndex: fields.categoryIndex,
          name: fields.name.trim(),
          description: fields.description.trim() || undefined,
          website: fields.website.trim() || undefined,
        },
        provider,
      );

      setLoadingPhase("confirming");
      const hash = await writeContractAsync({
        address: staking,
        abi: KarProStakingAbi,
        functionName: "becomeVerifierNative",
        args: [fields.categoryIndex, fields.name.trim(), metadataUri],
        value: minStake ?? parseEther("0.05"),
      });

      await waitForTransactionReceipt(config, { hash });
      setLoadingPhase("idle");
      onSuccess();
    } catch (err) {
      setLoadingPhase("idle");
      if (err instanceof Error && err.message.includes("User rejected")) {
        setError("Transaction cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
    }
  };

  if (step === 1) {
    return (
      <div className="space-y-6">
        <KarProProfileFields values={fields} onChange={setFields} disabled={isBusy} />
        {error && (
          <p role="alert" className="font-sans text-fluid-sm text-status-error">
            {error}
          </p>
        )}
        <Button type="button" variant="ghost" disabled={isBusy} onClick={onContinue}>
          Continue →
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <article className="rounded-md border border-border-default bg-bg-card p-6">
        <p className="font-sans text-fluid-sm text-text-secondary">Profile summary</p>
        <p className="mt-2 font-sans text-base font-medium text-text-primary">{fields.name.trim()}</p>
        <p className="mt-1 font-mono text-xs uppercase tracking-wider text-text-secondary">
          {categoryIndexToLabel(fields.categoryIndex)}
        </p>
      </article>

      <div className="space-y-2">
        <p className="font-sans text-base text-text-primary">
          <span className="font-mono tabular-nums">{stakeLabel} ETH</span>
          {" — fully refundable anytime"}
        </p>
        <ul className="list-disc space-y-1 pl-5 font-sans text-fluid-sm text-text-secondary">
          <li>No lock period</li>
          <li>Fully refundable — call leave() anytime</li>
          <li>Your verification history stays on-chain permanently</li>
        </ul>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          type="button"
          disabled={isBusy || !staking}
          aria-busy={isBusy}
          onClick={() => void onStake()}
        >
          {loadingPhase === "uploading"
            ? "Uploading profile…"
            : loadingPhase === "confirming"
              ? "Confirming transaction…"
              : `Stake ${stakeLabel} ETH & become KarPro`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isBusy}
          onClick={() => {
            setStep(1);
            setError(null);
          }}
        >
          Back
        </Button>
        {error && (
          <p role="alert" className="font-sans text-fluid-sm text-status-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
