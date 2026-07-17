"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";

import {
  KarProProfileFields,
  type KarProProfileFieldValues,
  type SlugAvailabilityStatus,
} from "@/components/kar-pro/kar-pro-profile-fields";
import { Button } from "@/components/ui/button";
import { useMinStakeNative } from "@/hooks/use-min-stake-native";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { KarProStakingAbi } from "@/lib/contracts/abis.generated";
import {
  categoryIndexToLabel,
  SLUG_PATTERN,
  uploadKarProMetadata,
} from "@/lib/kar-pro/kar-pro-metadata";
import { getWalletUploadProvider } from "@/lib/passport/upload-passport-metadata";
import { karProStakingAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID } from "@/lib/web3/supported-chains";

type LoadingPhase = "idle" | "uploading";

export function KarProJoinForm({ onSuccess }: { onSuccess: () => void }) {
  const chainId = DEFAULT_CHAIN_ID;
  const { address, connector } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { runTx, phase: txPhase, error: txSyncError, syncLagged } = useTxSync(chainId);

  const [step, setStep] = useState<1 | 2>(1);
  const [fields, setFields] = useState<KarProProfileFieldValues>({
    categoryIndex: 0,
    name: "",
    slug: "",
    description: "",
    website: "",
  });
  const [slugAvailability, setSlugAvailability] = useState<SlugAvailabilityStatus>("idle");
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const staking = karProStakingAddress(chainId);

  const { minStake, stakeLabel } = useMinStakeNative();
  const isBusy = loadingPhase !== "idle" || txPhase !== "idle";
  const stakeReady = minStake !== undefined;

  const onContinue = () => {
    if (!fields.name.trim()) {
      setError("Enter a display name.");
      return;
    }
    const slug = fields.slug.trim();
    if (!slug) {
      setError("Enter a pro URL slug.");
      return;
    }
    if (!SLUG_PATTERN.test(slug)) {
      setError("Pro URL must use lowercase letters, numbers, and hyphens only.");
      return;
    }
    if (slugAvailability !== "available") {
      setError(
        slugAvailability === "taken"
          ? "That pro URL is already taken."
          : "Choose an available pro URL before continuing.",
      );
      return;
    }
    setError(null);
    setStep(2);
  };

  const onStake = async () => {
    if (!staking || !fields.name.trim() || !fields.slug.trim() || minStake === undefined) return;
    setError(null);

    try {
      setLoadingPhase("uploading");
      const provider = await getWalletUploadProvider(connector ?? undefined);
      const metadataUri = await uploadKarProMetadata(
        {
          categoryIndex: fields.categoryIndex,
          name: fields.name.trim(),
          slug: fields.slug.trim(),
          description: fields.description.trim() || undefined,
          website: fields.website.trim() || undefined,
        },
        provider,
      );

      setLoadingPhase("idle");
      const succeeded = await runTx(
        () =>
          writeContractAsync({
            address: staking,
            abi: KarProStakingAbi,
            functionName: "becomeVerifierNative",
            args: [fields.categoryIndex, fields.name.trim(), metadataUri],
            value: minStake,
          }),
        {
          mapError: (err) =>
            err instanceof Error && err.message.includes("User rejected")
              ? "Transaction cancelled."
              : err instanceof Error
                ? err.message
                : "Something went wrong. Try again.",
        },
      );
      if (succeeded) onSuccess();
    } catch (err) {
      setLoadingPhase("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  if (step === 1) {
    return (
      <div className="space-y-6">
        <KarProProfileFields
          values={fields}
          onChange={setFields}
          disabled={isBusy}
          ownerAddress={address}
          onSlugAvailabilityChange={setSlugAvailability}
        />
        {(error ?? txSyncError) && (
          <p role="alert" className="font-sans text-fluid-sm text-status-error">
            {error ?? txSyncError}
          </p>
        )}
        {syncLagged && (
          <p role="status" className="font-sans text-xs text-text-tertiary">
            {TX_SYNC_LAG_ADVISORY}
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
        <p className="mt-3 font-mono text-sm text-text-secondary">
          Your showroom: kargain.com/pro/{fields.slug.trim()}
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
          disabled={isBusy || !staking || !stakeReady}
          aria-busy={isBusy}
          onClick={() => void onStake()}
        >
          {loadingPhase === "uploading"
            ? "Uploading profile…"
            : txPhase === "indexing"
              ? "Confirming…"
              : txPhase !== "idle"
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
        {(error ?? txSyncError) && (
          <p role="alert" className="font-sans text-fluid-sm text-status-error">
            {error ?? txSyncError}
          </p>
        )}
        {syncLagged && (
          <p role="status" className="font-sans text-xs text-text-tertiary">
            {TX_SYNC_LAG_ADVISORY}
          </p>
        )}
      </div>
    </div>
  );
}
