"use client";

import Link from "next/link";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

import { PassportMetadataFields } from "@/components/passport/passport-metadata-fields";
import { MetadataChangeConfirmDialog } from "@/components/passport/metadata-change-confirm-dialog";
import { PassportEditSuccessBanner } from "@/components/passport/passport-edit-success-banner";
import { PassportIndexerSyncBanner } from "@/components/passport/passport-indexer-sync-banner";
import { PassportUploadPreflightBanner } from "@/components/passport/passport-upload-preflight-banner";
import { PassportUploadProgressPanel } from "@/components/passport/passport-upload-progress";
import { PassportIdLabel } from "@/components/passport/passport-id-label";
import { PhotoThumbGrid } from "@/components/passport/photo-thumb-grid";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { TX_SYNC_LAG_ADVISORY, useTxSync } from "@/hooks/use-tx-sync";
import { useWalletAccountKind } from "@/hooks/use-wallet-account-kind";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import { isHeicFile } from "@/lib/passport/compress-passport-image";
import {
  buildMetadataWireForEdit,
  formInputToMetadataPreview,
} from "@/lib/passport/build-metadata-json";
import {
  diffPassportMetadata,
  hasAnchorChanges,
} from "@/lib/passport/metadata-diff";
import {
  formatMetadataDiffForDisplay,
  type MetadataDiffDisplay,
  type PhotoDisplayContext,
} from "@/lib/passport/format-metadata-diff-display";
import { MAX_PHOTOS } from "@/lib/passport/metadata-constants";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";
import {
  metadataToFormInput,
  normalizeVin,
  validateCreateFormInput,
  type PassportCreateFormErrors,
  type PassportEditFormInput,
  type PassportFormFieldKey,
} from "@/lib/passport/metadata-schema";
import { parseMetadataJson } from "@/lib/passport/parse-metadata-json";
import {
  editConfirmingOnChain,
  editPhaseLabel,
  editSavingOnChain,
  editUploadStarting,
  passportImageOptimizeErrorMessage,
  VERIFIED_ANCHOR_WARNING,
  type EditPhase,
} from "@/lib/passport/passport-flow-messages";
import type { PassportStatus } from "@/lib/types/ponder";
import {
  formatPassportUploadError,
  getWalletUploadProvider,
  uploadPassportToIrys,
  type UploadProgress,
} from "@/lib/passport/upload-passport-metadata";
import { processPassportPhotoFiles } from "@/lib/passport/process-passport-photo-files";
import { reorderArrayItem } from "@/lib/reorder-array";
import { resetIrysUploaderCache } from "@/lib/storage/irys-client";
import { resolveUri } from "@/lib/storage/resolve-uri";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { shortChainName, wagmiChainId } from "@/lib/web3/supported-chains";

type EditPhotoItem =
  | { id: string; kind: "existing"; uri: string }
  | { id: string; kind: "new"; file: File };

function initialEditPhotos(uris: string[]): EditPhotoItem[] {
  return uris.map((uri) => ({ id: uri, kind: "existing", uri }));
}

type Props = {
  tokenId: string;
  chainId: number;
  status: PassportStatus;
  initialMetadata: PassportMetadata;
  existingPhotoUris: string[];
};

export function EditPassportWizard({
  tokenId,
  chainId,
  status,
  initialMetadata,
  existingPhotoUris,
}: Props) {
  const { address, isConnected, connector } = useAccount();
  const walletChain = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending, reset: resetWrite } = useWriteContract();
  const {
    runTx,
    phase: txPhase,
    error: txError,
    syncLagged,
  } = useTxSync(chainId);
  const wc = wagmiChainId(chainId);
  const wrongChain = isConnected && walletChain !== chainId;
  const { kind: accountKind, isLoading: isLoadingAccountKind } = useWalletAccountKind(
    address,
    connector,
  );

  const [baselineMetadata, setBaselineMetadata] = useState(initialMetadata);
  const [passportStatus, setPassportStatus] = useState(status);
  const [form, setForm] = useState<PassportEditFormInput>(() =>
    metadataToFormInput(initialMetadata),
  );
  const [photos, setPhotos] = useState<EditPhotoItem[]>(() =>
    initialEditPhotos(existingPhotoUris),
  );
  const [errors, setErrors] = useState<PassportCreateFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDisplay, setPendingDisplay] = useState<MetadataDiffDisplay | null>(null);
  const [phase, setPhase] = useState<EditPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [isOptimizingPhotos, setIsOptimizingPhotos] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [hadVerificationReset, setHadVerificationReset] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const previewSrcs = useMemo(
    () =>
      photos.map((item) =>
        item.kind === "existing"
          ? resolveUri(item.uri, chainId)
          : URL.createObjectURL(item.file),
      ),
    [photos, chainId],
  );

  useEffect(() => {
    return () => {
      for (const [index, item] of photos.entries()) {
        if (item.kind === "new") URL.revokeObjectURL(previewSrcs[index]!);
      }
    };
  }, [photos, previewSrcs]);

  const clearSuccessState = useCallback(() => {
    setShowSuccess(false);
    setPhase((current) => (current === "success" ? "idle" : current));
  }, []);

  const updateField = useCallback(
    (key: PassportFormFieldKey, value: string) => {
      clearSuccessState();
      setForm((prev) => ({
        ...prev,
        [key]: key === "vin" ? normalizeVin(value) : value,
      }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [clearSuccessState],
  );

  const newPhotosForPreflight = useMemo(
    () =>
      photos
        .filter((item): item is Extract<EditPhotoItem, { kind: "new" }> => item.kind === "new")
        .map((item) => item.file),
    [photos],
  );

  const onPhotosSelected = (files: FileList | null) => {
    if (!files?.length) return;
    clearSuccessState();
    const incoming = Array.from(files).filter(
      (f) => f.type.startsWith("image/") || isHeicFile(f),
    );
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;

    const batch = incoming.slice(0, remaining);
    if (batch.length === 0) return;

    setIsOptimizingPhotos(true);
    setFormError(null);

    void processPassportPhotoFiles(batch)
      .then((optimized) => {
        setPhotos((prev) => {
          const total = prev.length + optimized.length;
          if (total > MAX_PHOTOS) {
            setFormError(`Maximum ${MAX_PHOTOS} photos allowed.`);
            return prev;
          }
          return [
            ...prev,
            ...optimized.map((file) => ({ id: nanoid(), kind: "new" as const, file })),
          ];
        });
      })
      .catch((err) => {
        setFormError(passportImageOptimizeErrorMessage(err));
      })
      .finally(() => {
        setIsOptimizingPhotos(false);
        if (photoInputRef.current) photoInputRef.current.value = "";
      });
  };

  const removePhoto = (index: number) => {
    clearSuccessState();
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const reorderPhoto = (fromIndex: number, toIndex: number) => {
    clearSuccessState();
    setPhotos((prev) => reorderArrayItem(prev, fromIndex, toIndex));
  };

  const photoDisplayContext = useMemo((): PhotoDisplayContext => ({
    resolveThumb: (_uri, index) => {
      const item = photos[index];
      const src = previewSrcs[index];
      if (!item || !src) return null;
      if (item.kind === "existing") {
        return { src, alt: "Existing photo" };
      }
      return { src, alt: item.file.name };
    },
  }), [photos, previewSrcs]);

  const computeVerificationReset = useCallback((): boolean => {
    const previewPhotoUris = photos.map((item) =>
      item.kind === "existing" ? item.uri : `new:${item.id}`,
    );
    const afterMetadata = formInputToMetadataPreview(form, previewPhotoUris, {
      createdAt: baselineMetadata.createdAt,
      updatedAt: new Date().toISOString(),
    });
    const diff = diffPassportMetadata(baselineMetadata, afterMetadata);
    return passportStatus === "VERIFIED" && hasAnchorChanges(diff);
  }, [baselineMetadata, form, passportStatus, photos]);

  const executeSave = async () => {
    if (!address || !connector) return;
    const passport = karPassportAddress(chainId);
    if (!passport) {
      setFormError("Passport contract not configured.");
      return;
    }

    const hadVerificationResetOnSave = computeVerificationReset();

    setPhase("uploading");
    setFormError(null);
    setUploadProgress(null);
    setShowSuccess(false);

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      await ensureSiweSession({
        address,
        chainId,
        signMessageAsync,
      });
      const provider = await getWalletUploadProvider(connector);

      const newFiles = photos
        .filter((item): item is Extract<EditPhotoItem, { kind: "new" }> => item.kind === "new")
        .map((item) => item.file);
      const createdAt = baselineMetadata.createdAt ?? new Date().toISOString();

      const savedMetadataRef: { current: PassportMetadata | null } = {
        current: null,
      };

      const uri = await uploadPassportToIrys({
        newPhotoFiles: newFiles,
        buildMetadata: (uploadedNewPhotoUris) => {
          let uploadIndex = 0;
          const photoUris = photos.map((item) => {
            if (item.kind === "existing") return item.uri;
            return uploadedNewPhotoUris[uploadIndex++]!;
          });
          const wire = buildMetadataWireForEdit(form, photoUris, { createdAt });
          savedMetadataRef.current = parseMetadataJson(wire);
          return wire;
        },
        provider,
        onProgress: setUploadProgress,
      });

      const savedMetadata = savedMetadataRef.current;
      if (!savedMetadata) {
        throw new Error("Failed to prepare saved metadata.");
      }

      setUploadProgress(null);
      setPhase("saving");
      const synchronized = await runTx(() =>
        writeContractAsync({
          address: passport,
          abi: KarPassportAbi,
          functionName: "setPassportURI",
          args: [BigInt(tokenId), uri],
          chainId: wc,
        }),
      );
      if (!synchronized) {
        resetIrysUploaderCache();
        setUploadProgress(null);
        setPhase("idle");
        resetWrite();
        return;
      }

      setBaselineMetadata(savedMetadata);
      setForm(metadataToFormInput(savedMetadata));
      setPhotos(initialEditPhotos(savedMetadata.photos));
      setPassportStatus((prev) =>
        hadVerificationResetOnSave ? "UNVERIFIED" : prev,
      );
      setHadVerificationReset(hadVerificationResetOnSave);
      setShowSuccess(true);
      setPhase("success");
      resetWrite();
    } catch (err) {
      resetIrysUploaderCache();
      setFormError(formatPassportUploadError(err));
      setUploadProgress(null);
      setPhase("idle");
      resetWrite();
    }
  };

  const onSubmit = () => {
    const nextErrors = validateCreateFormInput(form);
    if (photos.length < 1) {
      setErrors({ ...nextErrors, photos: "At least one photo is required." });
      return;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const previewPhotoUris = photos.map((item) =>
      item.kind === "existing" ? item.uri : `new:${item.id}`,
    );
    const afterMetadata = formInputToMetadataPreview(form, previewPhotoUris, {
      createdAt: baselineMetadata.createdAt,
      updatedAt: new Date().toISOString(),
    });

    const diff = diffPassportMetadata(baselineMetadata, afterMetadata);
    if (hasAnchorChanges(diff) || diff.cosmetic.length > 0) {
      setPendingDisplay(
        formatMetadataDiffForDisplay(diff, { photoContext: photoDisplayContext }),
      );
      setConfirmOpen(true);
      return;
    }
    void executeSave();
  };

  const isBusy =
    phase === "uploading" ||
    phase === "saving" ||
    phase === "confirming" ||
    txPhase !== "idle" ||
    isPending ||
    isOptimizingPhotos;

  const displayPhase =
    txPhase === "confirming" || txPhase === "indexing"
      ? "confirming"
      : phase;
  const saveButtonLabel =
    displayPhase === "idle" || displayPhase === "success"
      ? "Save changes"
      : editPhaseLabel(displayPhase);

  if (!isConnected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">Connect wallet to edit this passport.</p>
        <WalletLoginButton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex flex-wrap items-baseline gap-x-2 text-xl font-medium">
          <span>Edit passport</span>
          <PassportIdLabel tokenId={tokenId} chainId={chainId} prefix="none" />
        </h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>← Back</Link>
        </Button>
      </div>

      {showSuccess && (
        <PassportEditSuccessBanner
          tokenId={tokenId}
          chainId={chainId}
          hadVerificationReset={hadVerificationReset}
          onDismiss={() => {
            setShowSuccess(false);
            setPhase("idle");
          }}
        />
      )}

      <PassportIndexerSyncBanner
        tokenId={tokenId}
        chainId={chainId}
        enabled={showSuccess}
        variant="edit"
      />

      {passportStatus === "VERIFIED" && (
        <p className="rounded-md border border-status-error/40 p-4 text-sm text-text-secondary">
          {VERIFIED_ANCHOR_WARNING}
        </p>
      )}

      {wrongChain && (
        <p className="rounded-md border border-border-hover bg-bg-surface p-4 text-sm text-text-secondary">
          Switch to {shortChainName(chainId)} to save.{" "}
          <button
            type="button"
            className="link-underline"
            onClick={() => void switchChainAsync?.({ chainId: wc })}
          >
            Switch network
          </button>
        </p>
      )}

      {(formError ?? txError) && (
        <p className="font-sans text-sm whitespace-pre-line text-status-error" role="alert">
          {formError ?? txError}
        </p>
      )}
      {syncLagged && (
        <p role="status" className="font-sans text-xs text-text-tertiary">
          {TX_SYNC_LAG_ADVISORY}
        </p>
      )}

      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
        <PassportMetadataFields
          form={form}
          errors={errors}
          disabled={isBusy}
          onFieldChange={updateField}
        />

        <div className="space-y-2 border-t border-border-default pt-6">
          <Label>Photos</Label>
          <PassportUploadPreflightBanner
            accountKind={accountKind}
            photos={newPhotosForPreflight}
            isLoadingKind={isLoadingAccountKind}
            context="edit"
          />
          {photos.length > 0 && (
            <>
              <p className="font-mono text-xs text-text-tertiary">
                First photo is the cover. Use arrows to reorder.
              </p>
              <PhotoThumbGrid
                items={photos.map((item, index) => ({
                  id: item.id,
                  src: previewSrcs[index]!,
                  alt: item.kind === "existing" ? "Existing photo" : item.file.name,
                }))}
                disabled={isBusy}
                onRemove={removePhoto}
                onReorder={reorderPhoto}
              />
            </>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="sr-only"
            onChange={(e) => onPhotosSelected(e.target.files)}
            disabled={isBusy}
          />
          <Button type="button" variant="secondary" disabled={isBusy || photos.length >= MAX_PHOTOS} onClick={() => photoInputRef.current?.click()}>
            Add photos
          </Button>
          {isOptimizingPhotos && (
            <p className="font-sans text-xs text-text-tertiary" role="status">
              Optimizing photos…
            </p>
          )}
          {errors.photos && <p className="text-xs text-status-error">{errors.photos}</p>}
        </div>

        {phase === "uploading" &&
          (uploadProgress ? (
            <PassportUploadProgressPanel uploadProgress={uploadProgress} context="edit" />
          ) : (
            <p className="font-sans text-sm text-text-secondary">{editUploadStarting()}</p>
          ))}

        {displayPhase === "saving" && (
          <p className="font-sans text-sm text-text-secondary">{editSavingOnChain()}</p>
        )}

        {displayPhase === "confirming" && (
          <p className="font-sans text-sm text-text-secondary">
            {editConfirmingOnChain(shortChainName(chainId))}
          </p>
        )}

        <Button type="button" className="w-full" disabled={isBusy} onClick={onSubmit}>
          {saveButtonLabel}
        </Button>
      </div>

      <MetadataChangeConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        display={pendingDisplay}
        status={passportStatus}
        onConfirm={() => {
          setConfirmOpen(false);
          void executeSave();
        }}
      />
    </div>
  );
}
