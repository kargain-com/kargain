"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { parseEventLogs, UserRejectedRequestError, type Hash } from "viem";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { PassportMetadataFields } from "@/components/passport/passport-metadata-fields";
import { PhotoUploadZone } from "@/components/passport/photo-upload-zone";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { buildMetadataWire } from "@/lib/passport/build-metadata-json";
import { MAX_PHOTOS } from "@/lib/passport/metadata-constants";
import {
  emptyPassportFormInput,
  normalizeVin,
  validateCreateFormInput,
  type PassportCreateFormInput,
  type PassportCreateFormErrors,
  type PassportFormFieldKey,
} from "@/lib/passport/metadata-schema";
import {
  getWalletUploadProvider,
  uploadPassportMetadataJson,
  uploadPassportPhotos,
  type UploadProgress,
} from "@/lib/passport/upload-passport-metadata";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

const MAX_PHOTOS_LIMIT = MAX_PHOTOS;

type Step = 1 | 2;
type Phase = "idle" | "uploading" | "minting" | "success" | "error";

type FormState = PassportCreateFormInput;

type FieldErrors = PassportCreateFormErrors;

function isWalletRejection(err: unknown): boolean {
  if (err instanceof UserRejectedRequestError) return true;
  return err instanceof Error && err.message.includes("User rejected");
}

export function CreatePassportWizard() {
  const router = useRouter();
  const { address, isConnected, connector } = useAccount();
  const walletChain = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending: isWritePending, reset: resetWrite } =
    useWriteContract();

  const chainId = DEFAULT_CHAIN_ID;
  const wc = wagmiChainId(chainId);
  const wrongChain = isConnected && walletChain !== chainId;

  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<Hash | undefined>();

  const {
    data: mintReceipt,
    isLoading: isConfirming,
    error: mintReceiptError,
  } = useWaitForTransactionReceipt({ hash: mintHash });

  const [form, setForm] = useState<FormState>(() => emptyPassportFormInput());

  const [photos, setPhotos] = useState<File[]>([]);
  const [metadataUri, setMetadataUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  const updateField = useCallback((key: PassportFormFieldKey, value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: key === "vin" ? normalizeVin(value) : value,
    }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const onContinue = () => {
    const nextErrors = validateCreateFormInput(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setStep(2);
    setFormError(null);
  };

  const onPhotosAdd = (files: File[]) => {
    setPhotos((prev) => {
      const merged = [...prev, ...files].slice(0, MAX_PHOTOS_LIMIT);
      return merged;
    });
    setErrors((prev) => ({ ...prev, photos: undefined }));
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const startMint = useCallback(
    async (uri: string) => {
      if (!address) {
        setFormError("Connect your wallet to create a passport.");
        return;
      }

      const contractAddress = karPassportAddress(walletChain);
      if (!contractAddress) {
        setFormError("Passport contract not available on this network");
        setPhase("error");
        return;
      }

      setPhase("minting");
      setFormError(null);
      resetWrite();
      setMintHash(undefined);

      try {
        const hash = await writeContractAsync({
          address: contractAddress,
          abi: KarPassportAbi,
          functionName: "mintPassport",
          args: [address, uri],
        });
        setMintHash(hash);
      } catch (err) {
        if (isWalletRejection(err)) {
          setPhase("idle");
          setFormError("Transaction cancelled. Try again when ready.");
        } else {
          setPhase("error");
          setFormError(
            err instanceof Error ? err.message : "Mint failed. Please try again.",
          );
        }
      }
    },
    [address, walletChain, writeContractAsync, resetWrite],
  );

  useEffect(() => {
    if (!mintReceipt) return;

    const events = parseEventLogs({
      abi: KarPassportAbi,
      logs: mintReceipt.logs,
      eventName: "PassportMinted",
    });
    const minted = events[0];
    if (!minted || minted.eventName !== "PassportMinted") {
      setFormError(
        "Mint succeeded but token ID could not be read. Check your wallet for the NFT.",
      );
      setPhase("error");
      return;
    }

    setPhase("success");
    router.push(
      `/marketplace/${minted.args.tokenId.toString()}?chain=${walletChain}`,
    );
  }, [mintReceipt, router, walletChain]);

  useEffect(() => {
    if (!mintReceiptError) return;
    setFormError("Transaction failed on-chain. Please try again.");
    setPhase("error");
  }, [mintReceiptError]);

  const onCreatePassport = async () => {
    setFormError(null);
    setErrors({});

    if (!isConnected || !address) {
      setFormError("Connect your wallet to create a passport.");
      return;
    }
    if (wrongChain) {
      setFormError("Switch to Base Sepolia to mint.");
      return;
    }
    if (photos.length < 1) {
      setErrors({ photos: "Add at least one photo." });
      return;
    }

    const step1Errors = validateCreateFormInput(form);
    if (Object.keys(step1Errors).length > 0) {
      setErrors(step1Errors);
      setStep(1);
      return;
    }

    if (metadataUri) {
      await startMint(metadataUri);
      return;
    }

    setPhase("uploading");
    setUploadProgress(null);

    try {
      await ensureSiweSession({
        address,
        chainId,
        signMessageAsync,
      });
    } catch (err) {
      setUploadProgress(null);
      if (err instanceof Error && err.message.includes("User rejected")) {
        setFormError("Transaction cancelled.");
      } else {
        setFormError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      }
      setPhase("error");
      return;
    }

    try {
      const provider = await getWalletUploadProvider(connector);

      const photoUris = await uploadPassportPhotos(photos, provider, setUploadProgress);

      const metadata = buildMetadataWire(form, photoUris);

      setUploadProgress({ kind: "metadata" });
      const uri = await uploadPassportMetadataJson(metadata, provider);

      setMetadataUri(uri);
      setUploadProgress(null);
      await startMint(uri);
    } catch {
      setFormError("Upload failed. Please try again.");
      setUploadProgress(null);
      setPhase("error");
    }
  };

  const isBusy =
    phase === "uploading" ||
    phase === "minting" ||
    isWritePending ||
    isConfirming;

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-16 text-center">
        <h1 className="text-2xl font-medium text-text-primary">Create passport</h1>
        <p className="text-sm text-text-secondary">
          Mint a KarPassport NFT with basic vehicle details and photos stored on Arweave.
        </p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <p className="font-mono text-xs font-medium tracking-[0.18em] uppercase text-text-tertiary">
          Step {step} of 2
        </p>
        <h1 className="font-display text-fluid-display font-medium tracking-[-0.02em] leading-[1.1] text-text-primary">Create passport</h1>
        <p className="font-sans text-fluid-sm font-normal leading-[1.5] text-text-secondary">
          {step === 1
            ? "Enter the essentials. You can enrich the passport over time."
            : "Upload photos and mint your KarPassport on Base Sepolia."}
        </p>
      </div>

      {wrongChain && (
        <p className="rounded-md border border-border-hover bg-bg-surface p-3 text-sm text-text-secondary">
          Switch to Base Sepolia to mint.{" "}
          <button
            type="button"
            className="link-underline"
            onClick={() => void switchChainAsync?.({ chainId: wc })}
          >
            Switch network
          </button>
        </p>
      )}

      {(formError) && (
        <p className="font-sans text-sm text-status-error" role="alert">
          {formError}
        </p>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <PassportMetadataFields
            form={form}
            errors={errors}
            onFieldChange={updateField}
          />

          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onContinue}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <h2 className="font-display text-lg font-medium text-text-primary mb-6">Add photos</h2>

          <PhotoUploadZone
            photos={photos}
            onAdd={onPhotosAdd}
            onRemove={removePhoto}
            maxPhotos={MAX_PHOTOS_LIMIT}
            error={errors.photos}
            disabled={isBusy}
          />

          {phase === "uploading" && uploadProgress && (
            <div className="space-y-2">
              <p className="font-sans text-sm text-text-secondary">
                {uploadProgress.kind === "photos"
                  ? `Uploading photo ${uploadProgress.current} of ${uploadProgress.total}…`
                  : "Preparing passport…"}
              </p>
              <Progress
                value={
                  uploadProgress.kind === "photos"
                    ? (uploadProgress.current / uploadProgress.total) * 100
                    : 100
                }
              />
            </div>
          )}

          {phase === "minting" && (
            <div className="space-y-1">
              <p className="font-sans text-sm text-text-secondary">
                Creating passport on-chain…
              </p>
              {(isWritePending || !mintHash) && (
                <p className="font-sans text-xs text-text-tertiary">
                  Confirm the transaction in your wallet
                </p>
              )}
              {mintHash && isConfirming && (
                <p className="font-sans text-xs text-text-tertiary">
                  Waiting for confirmation…
                </p>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-border-default pt-6">
            <Button
              type="button"
              variant="ghost"
              disabled={isBusy}
              onClick={() => {
                setStep(1);
                setFormError(null);
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isBusy || photos.length < 1}
              onClick={() => void onCreatePassport()}
            >
              {phase === "uploading"
                ? "Uploading…"
                : phase === "minting"
                  ? "Creating passport…"
                  : "Create passport"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
