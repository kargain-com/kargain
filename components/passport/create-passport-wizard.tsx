"use client";

import { useActiveAccount } from "@/hooks/use-active-account";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSignMessage } from "wagmi";
import type { Connector } from "wagmi";

import { KarProNetworkPrompt } from "@/components/kar-pro/kar-pro-network-prompt";
import { PassportMetadataFields } from "@/components/passport/passport-metadata-fields";
import { PassportUploadPreflightBanner } from "@/components/passport/passport-upload-preflight-banner";
import { PassportUploadProgressPanel } from "@/components/passport/passport-upload-progress";
import { PhotoUploadZone } from "@/components/passport/photo-upload-zone";
import { Button } from "@/components/ui/button";
import { SurfaceAdmissionRefusalView } from "@/components/shell/surface-admission-refusal";
import { useIrysDepositPorts } from "@/hooks/use-irys-deposit-ports";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useMintPassport } from "@/hooks/use-mint-passport";
import { useWalletAccountKind } from "@/hooks/use-wallet-account-kind";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { buildMetadataWire } from "@/lib/passport/build-metadata-json";
import {
  admitCreatePassport,
  createPassportIntroCopy,
  createPassportShowsMintIntro,
  resolveCreatePassportNamespace,
} from "@/lib/passport/create-passport-surface";
import {
  isMintPassportSendRefusal,
  mintPassportCauseCopy,
  MintPassportSendRefusal,
  resolveMintRefusal,
} from "@/lib/passport/mint-passport";
import { writeSubmissionReference } from "@/lib/web3/write-outcome";
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
import { unresolvedNamespaceCopy } from "@/lib/web3/commercial-active";
import {
  isSurfaceAdmissionAvailable,
} from "@/lib/web3/surface-admission";
import { commercialNetworkLabel } from "@/lib/web3/chain-selector-state";

const MAX_PHOTOS_LIMIT = MAX_PHOTOS;

type Step = 1 | 2;
type Phase = "idle" | "uploading" | "minting" | "success" | "error";

type FormState = PassportCreateFormInput;

type FieldErrors = PassportCreateFormErrors;

function missingMintedPassportCopy(): string {
  return "Mint succeeded but token ID could not be read. Check your wallet for the NFT.";
}

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
 * mounts when the namespace admits creation and the session family matches.
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
    const refusal =
      nsResult.cause === "disconnected"
        ? ({ status: "disconnected" } as const)
        : ({ status: "unresolved_namespace" } as const);
    return (
      <CreatePassportShell centered={nsResult.cause === "disconnected"}>
        {nsResult.cause === "disconnected" ? (
          <p className="text-sm text-text-secondary">
            {createPassportIntroCopy()}
          </p>
        ) : null}
        {nsResult.cause === "unresolved_namespace" ? (
          <KarProNetworkPrompt title={unresolvedNamespaceCopy()} />
        ) : (
          <SurfaceAdmissionRefusalView refusal={refusal} />
        )}
      </CreatePassportShell>
    );
  }

  const admission = admitCreatePassport(account, nsResult.namespace);

  if (!isSurfaceAdmissionAvailable(admission)) {
    return (
      <CreatePassportShell centered>
        {createPassportShowsMintIntro(admission) ? (
          <p className="text-sm text-text-secondary">
            {createPassportIntroCopy()}
          </p>
        ) : null}
        <SurfaceAdmissionRefusalView refusal={admission} />
      </CreatePassportShell>
    );
  }

  const connector = signingBinding.ok ? signingBinding.connector : undefined;
  const evmAddress = signingBinding.ok ? signingBinding.address : undefined;

  return (
    <CreatePassportWizardBody
      chainId={nsResult.namespace}
      account={account}
      connector={connector}
      evmAddress={evmAddress}
      svmWallet={svmWallet}
    />
  );
}

type BodyProps = {
  chainId: number;
  account: ActiveAccount;
  connector: Connector | undefined;
  /** EVM session address when signingBinding is ok — never invent from SVM. */
  evmAddress: `0x${string}` | undefined;
  /** Opaque wallet handle from useActiveAccount — typed at the Irys upload door. */
  svmWallet: Parameters<typeof uploadPassportToIrys>[0]["svmWallet"];
};

function CreatePassportWizardBody({
  chainId,
  account,
  connector,
  evmAddress,
  svmWallet,
}: BodyProps) {
  const router = useRouter();
  const depositPorts = useIrysDepositPorts(svmWallet);
  const { signMessageAsync } = useSignMessage();
  const {
    planMint,
    sendMint,
    isPending: isWritePending,
    reset: resetWrite,
  } = useMintPassport();
  const sessionAddress =
    account.status === "connected" ? account.address : undefined;
  const { kind: accountKind, isLoading: isLoadingAccountKind } =
    useWalletAccountKind(evmAddress, connector);
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
  const [mintRef, setMintRef] = useState<string | undefined>();

  const [form, setForm] = useState<FormState>(() => emptyPassportFormInput());

  const [photos, setPhotos] = useState<File[]>([]);
  const [metadataUri, setMetadataUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );

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
      setPhase("minting");
      setFormError(null);
      resetWrite();
      setMintRef(undefined);

      const planned = await planMint({ chainId, uri });
      if (!planned.ok) {
        setPhase("error");
        setFormError(mintPassportCauseCopy(planned.cause));
        resetWrite();
        return;
      }

      // Exactly one runTx: send inside lifecycle guard, then product confirm.
      const result = await runTx(
        async () => {
          const sent = await sendMint({ chainId, plan: planned });
          if (!sent.ok) {
            throw new MintPassportSendRefusal(sent.cause);
          }
          setMintRef(writeSubmissionReference(sent.submission));
          return sent.submission;
        },
        {
          mapError: (err) =>
            isMintPassportSendRefusal(err)
              ? mintPassportCauseCopy(err.mintCause)
              : mintPassportCauseCopy("send_failed"),
        },
      );

      if (!result.ok) {
        const mapped = await resolveMintRefusal({
          plan: planned,
          refusal: result.refusal,
        });
        if (
          mapped.cause === "wallet_rejected" ||
          mapped.cause === "mint_sequence_advanced" ||
          mapped.cause === "expired" ||
          mapped.cause === "reverted" ||
          mapped.cause === "superseded"
        ) {
          // Resubmittable — retain metadata URI (phase idle keeps uri state).
          setPhase("idle");
          setFormError(mapped.copy);
          resetWrite();
          return;
        }
        if (mapped.cause === "status_unknown") {
          // May still land — retain URI; no "try again" framing beyond owner copy.
          setPhase("error");
          setFormError(mapped.copy);
          resetWrite();
          return;
        }
        setPhase("error");
        setFormError(mapped.copy);
        resetWrite();
        return;
      }

      const minted = result.outcome.mintedPassportTokenId;
      if (!minted.ok) {
        if (minted.cause === "missing_minted_passport") {
          setPhase("error");
          setFormError(missingMintedPassportCopy());
          resetWrite();
          return;
        }
        return;
      }

      const tokenId = minted.tokenId;
      const txRef = result.outcome.writeReference;
      setPhase("success");
      resetWrite();
      router.push(
        `/marketplace/${tokenId}/created?chain=${chainId}&tx=${txRef}`,
      );
    },
    [chainId, planMint, resetWrite, router, runTx, sendMint],
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

    if (evmAddress != null) {
      try {
        await ensureSiweSession({
          address: evmAddress,
          chainId,
          signMessageAsync,
        });
      } catch (err) {
        setUploadProgress(null);
        setFormError(formatPassportUploadError(err));
        setPhase("error");
        return;
      }
    }

    try {
      const uri = await uploadPassportToIrys({
        newPhotoFiles: photos,
        buildMetadata: (photoUris) => buildMetadataWire(form, photoUris),
        account,
        evmConnector: connector,
        svmWallet,
        depositPorts,
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
  const named = commercialNetworkLabel(chainId);
  const step2Subtitle = named.ok
    ? `Upload photos and mint your KarPassport on ${named.label}.`
    : "Upload photos and mint your KarPassport.";

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
            : step2Subtitle}
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
              {(txPhase === "wallet" || isWritePending || !mintRef) && (
                <p className="font-sans text-xs text-text-tertiary">
                  Confirm the transaction in your wallet
                </p>
              )}
              {mintRef && txPhase === "confirming" && (
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
              disabled={isBusy || photos.length < 1 || sessionAddress == null}
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
