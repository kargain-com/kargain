"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { UserRejectedRequestError, type Hash } from "viem";
import { useSignMessage } from "wagmi";
import type { Connector } from "wagmi";

import { KarProNetworkPrompt } from "@/components/kar-pro/kar-pro-network-prompt";
import { PassportMetadataFields } from "@/components/passport/passport-metadata-fields";
import { PassportUploadPreflightBanner } from "@/components/passport/passport-upload-preflight-banner";
import { PassportUploadProgressPanel } from "@/components/passport/passport-upload-progress";
import { PhotoUploadZone } from "@/components/passport/photo-upload-zone";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { EvmSessionRefusal } from "@/components/shell/evm-session-refusal";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useWalletAccountKind } from "@/hooks/use-wallet-account-kind";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { resolveKarProTargetChainId } from "@/lib/kar-pro/kar-pro-target-chain";
import { buildMetadataWire } from "@/lib/passport/build-metadata-json";
import {
  admitCreatePassport,
  createPassportSessionRefusalCause,
  createPassportSupportRefusalCopy,
  resolveCreatePassportNamespace,
} from "@/lib/passport/create-passport-surface";
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
  formatPassportUploadError,
  uploadPassportToIrys,
  type UploadProgress,
} from "@/lib/passport/upload-passport-metadata";
import { reorderArrayItem } from "@/lib/reorder-array";
import { resetIrysUploaderCache } from "@/lib/storage/irys-client";
import type { ActiveAccount } from "@/lib/web3/active-account";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";
import { useEvmWriteContract } from "@/lib/web3/evm-write-adapter";

const MAX_PHOTOS_LIMIT = MAX_PHOTOS;

type Step = 1 | 2;
type Phase = "idle" | "uploading" | "minting" | "success" | "error";

type FormState = PassportCreateFormInput;

type FieldErrors = PassportCreateFormErrors;

function isWalletRejection(err: unknown): boolean {
  if (err instanceof UserRejectedRequestError) return true;
  return err instanceof Error && err.message.includes("User rejected");
}

const MINT_PARSE_ERROR_MESSAGE =
  "Mint succeeded but token ID could not be read. Check your wallet for the NFT.";

function CreatePassportShell({
  children,
  centered,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <div
      className={
        centered
          ? "mx-auto max-w-lg space-y-6 px-4 py-16 text-center"
          : "mx-auto max-w-lg space-y-6 px-4 py-16"
      }
    >
      <h1 className="text-2xl font-medium text-text-primary">Create passport</h1>
      {children}
    </div>
  );
}

/**
 * Gate: census support for create_passport, then session. Write/sync body
 * mounts only when the namespace admits creation and the session matches.
 */
export function CreatePassportWizard() {
  const { account, signingBinding, svmWallet } = useActiveAccount();
  const searchParams = useSearchParams();
  const urlChain = useMemo(() => {
    const raw = searchParams.get("chain");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [searchParams]);

  const nsResult = resolveCreatePassportNamespace({ account, urlChain });
  if (!nsResult.ok) {
    if (nsResult.cause === "disconnected") {
      return (
        <CreatePassportShell centered>
          <p className="text-sm text-text-secondary">
            Mint a KarPassport NFT with basic vehicle details and photos stored on
            Arweave.
          </p>
          <EvmSessionRefusal cause="disconnected" />
        </CreatePassportShell>
      );
    }
    return (
      <CreatePassportShell>
        <KarProNetworkPrompt title="Switch to a Kargain network to mint a passport." />
      </CreatePassportShell>
    );
  }

  const admission = admitCreatePassport(account, nsResult.namespace);

  if (admission.status === "support_refused") {
    const copy = createPassportSupportRefusalCopy(admission.cause);
    return (
      <CreatePassportShell centered>
        <EmptyState
          variant="infrastructure"
          level="B"
          title={copy.title}
          description={copy.detail || undefined}
        />
      </CreatePassportShell>
    );
  }

  if (admission.status === "unresolved_namespace") {
    return (
      <CreatePassportShell>
        <KarProNetworkPrompt title="Switch to a Kargain network to mint a passport." />
      </CreatePassportShell>
    );
  }

  if (admission.status === "session_refused") {
    return (
      <CreatePassportShell centered>
        <p className="text-sm text-text-secondary">
          Mint a KarPassport NFT with basic vehicle details and photos stored on
          Arweave.
        </p>
        <EvmSessionRefusal cause={createPassportSessionRefusalCause(admission)} />
      </CreatePassportShell>
    );
  }

  const chainId = resolveKarProTargetChainId(admission.chainId);
  if (chainId == null) {
    return (
      <CreatePassportShell>
        <KarProNetworkPrompt title="Switch to a Kargain network to mint a passport." />
      </CreatePassportShell>
    );
  }

  const connector = signingBinding.ok ? signingBinding.connector : undefined;

  return (
    <CreatePassportWizardBody
      chainId={chainId}
      address={admission.address}
      account={account}
      connector={connector}
      svmWallet={svmWallet}
    />
  );
}

type BodyProps = {
  chainId: number;
  address: `0x${string}`;
  account: ActiveAccount;
  connector: Connector | undefined;
  /** Opaque wallet handle from useActiveAccount — typed at the Irys upload door. */
  svmWallet: Parameters<typeof uploadPassportToIrys>[0]["svmWallet"];
};

function CreatePassportWizardBody({
  chainId,
  address,
  account,
  connector,
  svmWallet,
}: BodyProps) {
  const router = useRouter();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, isPending: isWritePending, reset: resetWrite } =
    useEvmWriteContract();
  const wc = wagmiChainId(chainId);
  const { kind: accountKind, isLoading: isLoadingAccountKind } = useWalletAccountKind(
    address,
    connector,
  );
  const {
    runTx,
    phase: txPhase,
    error: txError,
    syncLagged,
  } = useTxSync(chainId);

  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<Hash | undefined>();

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

  const reorderPhoto = (fromIndex: number, toIndex: number) => {
    setPhotos((prev) => reorderArrayItem(prev, fromIndex, toIndex));
  };

  const startMint = useCallback(
    async (uri: string) => {
      const contractAddress = karPassportAddress(chainId);
      if (!contractAddress) {
        setFormError("Passport contract not available on this network");
        setPhase("error");
        return;
      }

      setPhase("minting");
      setFormError(null);
      resetWrite();
      setMintHash(undefined);

      let mappedError: string | null = null;
      const result = await runTx(
        async () => {
          const hash = await writeContractAsync({
            address: contractAddress,
            abi: KarPassportAbi,
            functionName: "mintPassport",
            args: [address, uri],
            chainId: wc,
          });
          setMintHash(hash);
          return hash;
        },
        {
          mapError: (err) => {
            mappedError = isWalletRejection(err)
              ? "Transaction cancelled. Try again when ready."
              : err instanceof Error
                ? err.message
                : "Mint failed. Please try again.";
            return mappedError;
          },
        },
      );

      if (!result) {
        if (mappedError === "Transaction cancelled. Try again when ready.") {
          setPhase("idle");
        } else {
          setPhase("error");
        }
        setFormError(mappedError ?? "Mint failed. Please try again.");
        resetWrite();
        return;
      }

      const minted = result.mintedPassportTokenId;
      if (!minted.ok) {
        if (minted.cause === "missing_minted_passport") {
          setPhase("error");
          setFormError(MINT_PARSE_ERROR_MESSAGE);
          resetWrite();
          return;
        }
        return;
      }

      const tokenId = minted.tokenId;
      const txRef = result.writeReference;
      setPhase("success");
      resetWrite();
      router.push(
        `/marketplace/${tokenId}/created?chain=${chainId}&tx=${txRef}`,
      );
    },
    [address, chainId, resetWrite, router, runTx, wc, writeContractAsync],
  );

  const onCreatePassport = async () => {
    setFormError(null);
    setErrors({});

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
      setFormError(formatPassportUploadError(err));
      setPhase("error");
      return;
    }

    try {
      const uri = await uploadPassportToIrys({
        newPhotoFiles: photos,
        buildMetadata: (photoUris) => buildMetadataWire(form, photoUris),
        account,
        evmConnector: connector,
        svmWallet,
        onProgress: setUploadProgress,
      });

      setMetadataUri(uri);
      setUploadProgress(null);
      await startMint(uri);
    } catch (err) {
      resetIrysUploaderCache();
      setFormError(formatPassportUploadError(err));
      setUploadProgress(null);
      setPhase("error");
    }
  };

  const displayPhase: Phase =
    phase === "minting" && txPhase !== "idle" ? "minting" : phase;

  const isBusy =
    displayPhase === "uploading" ||
    displayPhase === "minting" ||
    isWritePending ||
    txPhase !== "idle";

  const displayError = formError ?? txError;
  const networkName = shortChainName(chainId);

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
            : `Upload photos and mint your KarPassport on ${networkName}.`}
        </p>
      </div>
      {displayError && (
        <p className="font-sans text-sm whitespace-pre-line text-status-error" role="alert">
          {displayError}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
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

          <PassportUploadPreflightBanner
            accountKind={accountKind}
            photos={photos}
            isLoadingKind={isLoadingAccountKind}
          />

          <PhotoUploadZone
            photos={photos}
            onAdd={onPhotosAdd}
            onRemove={removePhoto}
            onReorder={reorderPhoto}
            maxPhotos={MAX_PHOTOS_LIMIT}
            error={errors.photos}
            disabled={isBusy}
          />

          {displayPhase === "uploading" &&
            (uploadProgress ? (
              <PassportUploadProgressPanel uploadProgress={uploadProgress} context="create" />
            ) : (
              <p className="font-sans text-sm text-text-secondary">Starting upload…</p>
            ))}

          {displayPhase === "minting" && (
            <div className="space-y-1">
              <p className="font-sans text-sm text-text-secondary">
                Creating passport on-chain…
              </p>
              {(txPhase === "wallet" || isWritePending || !mintHash) && (
                <p className="font-sans text-xs text-text-tertiary">
                  Confirm the transaction in your wallet
                </p>
              )}
              {mintHash && txPhase === "confirming" && (
                <p className="font-sans text-xs text-text-tertiary">
                  Waiting for confirmation…
                </p>
              )}
              {txPhase === "indexing" && (
                <p className="font-sans text-xs text-text-tertiary">
                  Confirming…
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
              {displayPhase === "uploading"
                ? "Uploading…"
                : displayPhase === "minting"
                  ? "Creating passport…"
                  : "Create passport"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
