"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEventLogs, UserRejectedRequestError, type Hash } from "viem";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { uploadFile, uploadJson } from "@/lib/storage/irys-client";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { DEFAULT_CHAIN_ID, wagmiChainId } from "@/lib/web3/supported-chains";

const MAX_PHOTOS = 10;
const MAX_DESCRIPTION = 500;
const MIN_YEAR = 1900;

type Step = 1 | 2;
type Phase = "idle" | "uploading" | "minting" | "success" | "error";

type FormState = {
  vin: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  description: string;
};

type FieldErrors = Partial<Record<keyof FormState | "photos", string>>;

type UploadProgress =
  | { kind: "photos"; current: number; total: number }
  | { kind: "metadata" };

type PassportMetadata = {
  name: string;
  description?: string;
  make: string;
  model: string;
  year: number;
  fuel_type: string;
  body_type: string;
  transmission: string;
  mileage_km: number;
  color: string;
  vin: string;
  photos: string[];
  created_at: string;
  version: "1.0";
};

function normalizeVin(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "")
    .slice(0, 17);
}

function validateStep1(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const vin = form.vin.trim();
  const make = form.make.trim();
  const model = form.model.trim();
  const yearNum = Number.parseInt(form.year, 10);
  const maxYear = new Date().getFullYear() + 1;

  if (!vin) errors.vin = "VIN is required.";
  else if (vin.length < 11) errors.vin = "Enter a valid VIN (11–17 characters).";

  if (!make) errors.make = "Make is required.";
  if (!model) errors.model = "Model is required.";

  if (!form.year.trim()) errors.year = "Year is required.";
  else if (!Number.isFinite(yearNum) || yearNum < MIN_YEAR || yearNum > maxYear) {
    errors.year = `Year must be between ${MIN_YEAR} and ${maxYear}.`;
  }

  if (form.mileage.trim()) {
    const mileageNum = Number.parseInt(form.mileage, 10);
    if (!Number.isFinite(mileageNum) || mileageNum < 0) {
      errors.mileage = "Mileage must be a non-negative whole number.";
    }
  }

  if (form.description.length > MAX_DESCRIPTION) {
    errors.description = `Description must be at most ${MAX_DESCRIPTION} characters.`;
  }

  return errors;
}

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

  const [form, setForm] = useState<FormState>({
    vin: "",
    make: "",
    model: "",
    year: "",
    mileage: "",
    description: "",
  });

  const [photos, setPhotos] = useState<File[]>([]);
  const [metadataUri, setMetadataUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const previewUrls = useMemo(
    () => photos.map((file) => URL.createObjectURL(file)),
    [photos],
  );

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const updateField = useCallback((key: keyof FormState, value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: key === "vin" ? normalizeVin(value) : value,
    }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const onContinue = () => {
    const nextErrors = validateStep1(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setStep(2);
    setFormError(null);
  };

  const onPhotosSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => {
      const merged = [...prev, ...incoming].slice(0, MAX_PHOTOS);
      return merged;
    });
    setErrors((prev) => ({ ...prev, photos: undefined }));
    if (photoInputRef.current) photoInputRef.current.value = "";
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

    const step1Errors = validateStep1(form);
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
      const provider =
        (await connector?.getProvider()) ??
        (typeof window !== "undefined" ? window.ethereum : undefined);

      if (!provider) {
        setFormError("Connect your wallet to continue");
        setPhase("error");
        return;
      }

      const photoUris: string[] = [];
      for (let index = 0; index < photos.length; index += 1) {
        setUploadProgress({
          kind: "photos",
          current: index + 1,
          total: photos.length,
        });
        const uri = await uploadFile(
          photos[index],
          [
            { name: "app", value: "kargain" },
            { name: "type", value: "passport-photo" },
          ],
          provider,
        );
        photoUris.push(uri);
      }

      const yearNum = Number.parseInt(form.year, 10);
      const mileageKm = form.mileage.trim()
        ? Number.parseInt(form.mileage, 10)
        : 0;

      const metadata: PassportMetadata = {
        name: `${form.year} ${form.make.trim()} ${form.model.trim()}`.trim(),
        make: form.make.trim(),
        model: form.model.trim(),
        year: yearNum,
        fuel_type: "",
        body_type: "",
        transmission: "",
        mileage_km: mileageKm,
        color: "",
        vin: form.vin.trim(),
        photos: photoUris,
        created_at: new Date().toISOString(),
        version: "1.0",
      };

      if (form.description.trim()) {
        metadata.description = form.description.trim();
      }

      setUploadProgress({ kind: "metadata" });
      const uri = await uploadJson(
        metadata,
        [
          { name: "app", value: "kargain" },
          { name: "type", value: "passport-metadata" },
        ],
        provider,
      );

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
          <div className="space-y-1.5">
            <Label htmlFor="vin">VIN</Label>
            <Input
              id="vin"
              name="vin"
              value={form.vin}
              onChange={(e) => updateField("vin", e.target.value)}
              placeholder="17-character VIN"
              maxLength={17}
              autoComplete="off"
            />
            {errors.vin && <p className="font-sans text-sm text-status-error">{errors.vin}</p>}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="make">Make</Label>
              <Input
                id="make"
                name="make"
                value={form.make}
                onChange={(e) => updateField("make", e.target.value)}
                placeholder="e.g. Toyota"
              />
              {errors.make && <p className="font-sans text-sm text-status-error">{errors.make}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                name="model"
                value={form.model}
                onChange={(e) => updateField("model", e.target.value)}
                placeholder="e.g. Corolla"
              />
              {errors.model && <p className="font-sans text-sm text-status-error">{errors.model}</p>}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="year">Year</Label>
              <Input
                id="year"
                name="year"
                type="number"
                inputMode="numeric"
                value={form.year}
                onChange={(e) => updateField("year", e.target.value)}
                placeholder="2020"
                min={MIN_YEAR}
                max={new Date().getFullYear() + 1}
              />
              {errors.year && <p className="font-sans text-sm text-status-error">{errors.year}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mileage">Mileage (optional)</Label>
              <Input
                id="mileage"
                name="mileage"
                type="number"
                inputMode="numeric"
                value={form.mileage}
                onChange={(e) => updateField("mileage", e.target.value)}
                placeholder="85000"
                min={0}
              />
              {errors.mileage && <p className="font-sans text-sm text-status-error">{errors.mileage}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              name="description"
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Short note about condition or history"
              maxLength={MAX_DESCRIPTION}
              rows={4}
            />
            <p className="text-xs text-text-secondary">
              {form.description.length}/{MAX_DESCRIPTION}
            </p>
            {errors.description && (
              <p className="font-sans text-sm text-status-error">{errors.description}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={onContinue}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Photos (1–{MAX_PHOTOS})</Label>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="sr-only"
              id="passport-photos"
              onChange={(e) => onPhotosSelected(e.target.files)}
              disabled={isBusy || photos.length >= MAX_PHOTOS}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy || photos.length >= MAX_PHOTOS}
              onClick={() => photoInputRef.current?.click()}
            >
              Add photos
            </Button>
            {errors.photos && <p className="font-sans text-sm text-status-error">{errors.photos}</p>}
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((file, index) => (
                <div key={`${file.name}-${index}`} className="relative aspect-square overflow-hidden rounded-md border border-border-default bg-bg-surface">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrls[index]}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                  {!isBusy && (
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded-sm bg-bg-primary/80 px-1.5 py-0.5 font-sans text-xs text-text-primary hover:bg-bg-primary"
                      onClick={() => removePhoto(index)}
                      aria-label={`Remove ${file.name}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

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

          <div className="flex flex-wrap gap-3">
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
