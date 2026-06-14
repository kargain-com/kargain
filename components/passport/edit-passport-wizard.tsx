"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserRejectedRequestError } from "viem";
import {
  useAccount,
  useChainId,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { WalletLoginButton } from "@/components/wallet-login-button";
import { ensureSiweSession } from "@/lib/auth/ensure-siwe-session";
import { KarPassportAbi } from "@/lib/contracts/abis.generated";
import {
  buildMetadataWireForEdit,
  type PassportEditFormInput,
} from "@/lib/passport/build-metadata-json";
import {
  diffPassportMetadata,
  hasAnchorChanges,
} from "@/lib/passport/metadata-diff";
import {
  MAX_DESCRIPTION,
  MAX_PHOTOS,
  MIN_YEAR,
} from "@/lib/passport/metadata-constants";
import type { PassportMetadata } from "@/lib/passport/metadata-schema";
import {
  normalizeVin,
  validateCreateFormInput,
  type PassportCreateFormErrors,
} from "@/lib/passport/metadata-schema";
import type { PassportStatus } from "@/lib/types/ponder";
import { uploadFile, uploadJson } from "@/lib/storage/irys-client";
import { karPassportAddress } from "@/lib/web3/deployment-addresses";
import { wagmiChainId } from "@/lib/web3/supported-chains";

type Props = {
  tokenId: string;
  chainId: number;
  status: PassportStatus;
  initialMetadata: PassportMetadata;
  existingPhotoUris: string[];
};

function metadataToForm(metadata: PassportMetadata): PassportEditFormInput {
  return {
    vin: metadata.vin,
    make: metadata.make,
    model: metadata.model,
    year: metadata.year != null ? String(metadata.year) : "",
    mileage:
      metadata.mileageKm != null && metadata.mileageKm > 0
        ? String(metadata.mileageKm)
        : "",
    description: metadata.description ?? "",
    type: metadata.type ?? "",
    colour: metadata.colour ?? "",
    modelVariant: metadata.modelVariant ?? "",
    power: metadata.power ?? "",
    locationLabel: metadata.location?.label ?? "",
  };
}

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
    metadataToForm(initialMetadata),
  );
  const [existingPhotos, setExistingPhotos] = useState(existingPhotoUris);
  const [newPhotos, setNewPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<PassportCreateFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<ReturnType<
    typeof diffPassportMetadata
  > | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "saving">("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const previewUrls = useMemo(
    () => newPhotos.map((file) => URL.createObjectURL(file)),
    [newPhotos],
  );

  useEffect(() => {
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  const updateField = useCallback(
    (key: keyof PassportEditFormInput, value: string) => {
      setForm((prev) => ({
        ...prev,
        [key]: key === "vin" ? normalizeVin(value) : value,
      }));
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
    [],
  );

  const onPhotosSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setNewPhotos((prev) => {
      const total = existingPhotos.length + prev.length + incoming.length;
      if (total > MAX_PHOTOS) {
        setFormError(`Maximum ${MAX_PHOTOS} photos allowed.`);
        return prev;
      }
      return [...prev, ...incoming];
    });
  };

  const removeExistingPhoto = (index: number) => {
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const removeNewPhoto = (index: number) => {
    setNewPhotos((prev) => prev.filter((_, i) => i !== index));
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

    try {
      if (wrongChain) await switchChainAsync?.({ chainId: wc });
      await ensureSiweSession({
        address,
        chainId,
        signMessageAsync,
      });
      const provider =
        (await connector?.getProvider()) ??
        (typeof window !== "undefined" ? window.ethereum : undefined);
      if (!provider) throw new Error("Connect your wallet to continue");

      const photoUris = [...existingPhotos];
      for (let i = 0; i < newPhotos.length; i++) {
        const uri = await uploadFile(
          newPhotos[i]!,
          [{ name: "app", value: "kargain" }, { name: "type", value: "passport-photo" }],
          provider,
        );
        photoUris.push(uri);
      }

      const createdAt =
        initialMetadata.createdAt ?? new Date().toISOString();
      const metadata = buildMetadataWireForEdit(form, photoUris, { createdAt });

      setPhase("uploading");
      const uri = await uploadJson(
        metadata,
        [
          { name: "app", value: "kargain" },
          { name: "type", value: "passport-metadata" },
          { name: "version", value: "1.1" },
        ],
        provider,
      );

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
      if (err instanceof UserRejectedRequestError) {
        setFormError("Transaction cancelled.");
      } else {
        setFormError(err instanceof Error ? err.message : "Save failed.");
      }
      setPhase("idle");
      resetWrite();
    }
  };

  const onSubmit = () => {
    const nextErrors = validateCreateFormInput(form);
    if (form.description.length > MAX_DESCRIPTION) {
      nextErrors.description = `Description must be at most ${MAX_DESCRIPTION} characters.`;
    }
    const totalPhotos = existingPhotos.length + newPhotos.length;
    if (totalPhotos < 1) {
      setErrors({ ...nextErrors, photos: "At least one photo is required." });
      return;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const afterMetadata: PassportMetadata = {
      version: "1.1",
      vin: normalizeVin(form.vin),
      make: form.make.trim(),
      model: form.model.trim(),
      year: Number.parseInt(form.year, 10),
      mileageKm: form.mileage.trim() ? Number.parseInt(form.mileage, 10) : 0,
      photos: [...existingPhotos],
      description: form.description.trim() || undefined,
      type: form.type.trim() || undefined,
      colour: form.colour.trim() || undefined,
      modelVariant: form.modelVariant.trim() || undefined,
      power: form.power.trim() || undefined,
      location: form.locationLabel.trim()
        ? { label: form.locationLabel.trim() }
        : undefined,
    };

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

      <div className="space-y-4 rounded-md border border-border-default bg-bg-surface p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="vin">VIN</Label>
            <Input id="vin" value={form.vin} onChange={(e) => updateField("vin", e.target.value)} disabled={isBusy} />
            {errors.vin && <p className="text-xs text-status-error">{errors.vin}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="make">Make</Label>
            <Input id="make" value={form.make} onChange={(e) => updateField("make", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Input id="model" value={form.model} onChange={(e) => updateField("model", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="year">Year</Label>
            <Input id="year" type="number" min={MIN_YEAR} value={form.year} onChange={(e) => updateField("year", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mileage">Mileage (km)</Label>
            <Input id="mileage" value={form.mileage} onChange={(e) => updateField("mileage", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Input id="type" value={form.type} onChange={(e) => updateField("type", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="colour">Colour</Label>
            <Input id="colour" value={form.colour} onChange={(e) => updateField("colour", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="variant">Variant</Label>
            <Input id="variant" value={form.modelVariant} onChange={(e) => updateField("modelVariant", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="power">Power</Label>
            <Input id="power" value={form.power} onChange={(e) => updateField("power", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="location">Location label</Label>
            <Input id="location" value={form.locationLabel} onChange={(e) => updateField("locationLabel", e.target.value)} disabled={isBusy} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={form.description} onChange={(e) => updateField("description", e.target.value)} disabled={isBusy} rows={4} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Photos</Label>
          <div className="flex flex-wrap gap-2">
            {existingPhotos.map((uri, i) => (
              <div key={uri} className="relative">
                <span className="block max-w-[8rem] truncate font-mono text-xs">{uri.slice(0, 20)}…</span>
                <Button type="button" size="sm" variant="ghost" disabled={isBusy} onClick={() => removeExistingPhoto(i)}>
                  Remove
                </Button>
              </div>
            ))}
            {previewUrls.map((url, i) => (
              <div key={url} className="relative h-16 w-16 overflow-hidden rounded border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <Button type="button" size="sm" variant="ghost" disabled={isBusy} onClick={() => removeNewPhoto(i)}>
                  ×
                </Button>
              </div>
            ))}
          </div>
          <input ref={photoInputRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onPhotosSelected(e.target.files)} disabled={isBusy} />
          <Button type="button" variant="secondary" disabled={isBusy} onClick={() => photoInputRef.current?.click()}>
            Add photos
          </Button>
          {errors.photos && <p className="text-xs text-status-error">{errors.photos}</p>}
        </div>

        {phase === "uploading" && <Progress value={50} className="h-1" />}

        {formError && <p className="text-sm text-status-error">{formError}</p>}

        <Button type="button" className="w-full" disabled={isBusy} onClick={onSubmit}>
          {isBusy ? "Saving…" : "Save changes"}
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
