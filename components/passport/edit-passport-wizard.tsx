"use client";

import Link from "next/link";
import { nanoid } from "nanoid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { PassportMetadataFields } from "@/components/passport/passport-metadata-fields";
import { PassportUploadProgressPanel } from "@/components/passport/passport-upload-progress";
import { PhotoThumbGrid } from "@/components/passport/photo-thumb-grid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  buildMetadataWireForEdit,
  formInputToMetadataPreview,
} from "@/lib/passport/build-metadata-json";
import {
  diffPassportMetadata,
  hasAnchorChanges,
} from "@/lib/passport/metadata-diff";
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
import type { PassportStatus } from "@/lib/types/ponder";
import {
  formatPassportUploadError,
  getWalletUploadProvider,
  uploadPassportToIrys,
  type UploadProgress,
} from "@/lib/passport/upload-passport-metadata";
import { reorderArrayItem } from "@/lib/reorder-array";
import { resetIrysUploaderCache } from "@/lib/storage/irys-client";
import { resolveUri } from "@/lib/storage/resolve-uri";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

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
  const router = useRouter();
  const { address, isConnected, connector } = useAccount();
  const walletChain = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending, reset: resetWrite } = useWriteContract();
  const wc = wagmiChainId(chainId);
  const wrongChain = isConnected && walletChain !== chainId;

  const [form, setForm] = useState<PassportEditFormInput>(() =>
    metadataToFormInput(initialMetadata),
  );
  const [photos, setPhotos] = useState<EditPhotoItem[]>(() =>
    initialEditPhotos(existingPhotoUris),
  );
  const [errors, setErrors] = useState<PassportCreateFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<ReturnType<
    typeof diffPassportMetadata
  > | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const previewSrcs = useMemo(
    () =>
      photos.map((item) =>
        item.kind === "existing"
          ? resolveUri(item.uri, chainId)
          : URL.createObjectURL(item.file),
      ),
    [photos],
  );

  useEffect(() => {
    return () => {
      for (const [index, item] of photos.entries()) {
        if (item.kind === "new") URL.revokeObjectURL(previewSrcs[index]!);
      }
    };
  }, [photos, previewSrcs]);

  const updateField = useCallback((key: PassportFormFieldKey, value: string) => {
    setForm((prev) => ({
      ...prev,
      [key]: key === "vin" ? normalizeVin(value) : value,
    }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const onPhotosSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => {
      const total = prev.length + incoming.length;
      if (total > MAX_PHOTOS) {
        setFormError(`Maximum ${MAX_PHOTOS} photos allowed.`);
        return prev;
      }
      return [
        ...prev,
        ...incoming.map((file) => ({ id: nanoid(), kind: "new" as const, file })),
      ];
    });
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const reorderPhoto = (fromIndex: number, toIndex: number) => {
    setPhotos((prev) => reorderArrayItem(prev, fromIndex, toIndex));
  };

  const executeSave = async () => {
    if (!address || !connector) return;
    const passport = karPassportAddress(chainId);
    if (!passport) {
      setFormError("Passport contract not configured.");
      return;
    }

    setPhase("uploading");
    setFormError(null);
    setUploadProgress(null);

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
      const createdAt = initialMetadata.createdAt ?? new Date().toISOString();

      const uri = await uploadPassportToIrys({
        newPhotoFiles: newFiles,
        buildMetadata: (uploadedNewPhotoUris) => {
          let uploadIndex = 0;
          const photoUris = photos.map((item) => {
            if (item.kind === "existing") return item.uri;
            return uploadedNewPhotoUris[uploadIndex++]!;
          });
          return buildMetadataWireForEdit(form, photoUris, { createdAt });
        },
        provider,
        onProgress: setUploadProgress,
      });

      setUploadProgress(null);
      setPhase("saving");
      const hash = await writeContractAsync({
        address: passport,
        abi: KarPassportAbi,
        functionName: "setPassportURI",
        args: [BigInt(tokenId), uri],
      });
      setTxHash(hash);
      router.push(`/marketplace/${tokenId}?chain=${chainId}`);
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
      createdAt: initialMetadata.createdAt,
      updatedAt: new Date().toISOString(),
    });

    const diff = diffPassportMetadata(initialMetadata, afterMetadata);
    if (hasAnchorChanges(diff) || diff.cosmetic.length > 0) {
      setPendingDiff(diff);
      setConfirmOpen(true);
      return;
    }
    void executeSave();
  };

  const isBusy = phase !== "idle" || isPending || isConfirming;

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
        <h1 className="text-xl font-medium">Edit passport #{tokenId}</h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/marketplace/${tokenId}?chain=${chainId}`}>← Back</Link>
        </Button>
      </div>

      {status === "VERIFIED" && (
        <p className="rounded-md border border-status-error/40 p-4 text-sm text-text-secondary">
          This passport is verified. Anchor field changes will reset verification to UNVERIFIED.
        </p>
      )}

      {wrongChain && (
        <p className="rounded-md border border-border-hover bg-bg-surface p-3 text-sm text-text-secondary">
          Switch to Base Sepolia to save.{" "}
          <button
            type="button"
            className="link-underline"
            onClick={() => void switchChainAsync?.({ chainId: wc })}
          >
            Switch network
          </button>
        </p>
      )}

      {formError && (
        <p className="font-sans text-sm whitespace-pre-line text-status-error" role="alert">
          {formError}
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
          <input ref={photoInputRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onPhotosSelected(e.target.files)} disabled={isBusy} />
          <Button type="button" variant="secondary" disabled={isBusy || photos.length >= MAX_PHOTOS} onClick={() => photoInputRef.current?.click()}>
            Add photos
          </Button>
          {errors.photos && <p className="text-xs text-status-error">{errors.photos}</p>}
        </div>

        {phase === "uploading" &&
          (uploadProgress ? (
            <PassportUploadProgressPanel uploadProgress={uploadProgress} />
          ) : (
            <p className="font-sans text-sm text-text-secondary">Starting upload…</p>
          ))}

        {phase === "saving" && (
          <p className="font-sans text-sm text-text-secondary">Saving on-chain…</p>
        )}

        <Button type="button" className="w-full" disabled={isBusy} onClick={onSubmit}>
          {phase === "uploading"
            ? "Uploading…"
            : phase === "saving"
              ? "Saving…"
              : "Save changes"}
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm metadata changes</DialogTitle>
            <DialogDescription>
              Review anchor vs cosmetic changes before uploading a new metadata URI.
            </DialogDescription>
          </DialogHeader>
          {pendingDiff && (
            <div className="space-y-3 text-sm">
              {pendingDiff.anchor.length > 0 && (
                <div>
                  <p className="font-medium text-status-error">Anchor changes</p>
                  <ul className="mt-1 list-disc pl-5 text-text-secondary">
                    {pendingDiff.anchor.map((c) => (
                      <li key={c.field}>
                        {c.field}: {c.before || "—"} → {c.after || "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {pendingDiff.cosmetic.length > 0 && (
                <div>
                  <p className="font-medium">Cosmetic changes</p>
                  <ul className="mt-1 list-disc pl-5 text-text-secondary">
                    {pendingDiff.cosmetic.map((c) => (
                      <li key={c.field}>
                        {c.field}: {c.before || "—"} → {c.after || "—"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {status === "VERIFIED" && pendingDiff.anchor.length > 0 && (
                <p className="text-status-error">
                  Verification will be reset because anchor fields changed.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                void executeSave();
              }}
            >
              Confirm and save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
