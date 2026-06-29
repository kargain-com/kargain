"use client";

import { Info, AlertTriangle } from "lucide-react";

import { formatUploadSize, sumFileBytes } from "@/lib/storage/irys-upload-estimate";
import type { PassportFlowContext } from "@/lib/passport/passport-flow-messages";
import { preflightPhotoCountLabel } from "@/lib/passport/passport-flow-messages";
import {
  passportStorageUploadHint,
  type WalletAccountKind,
} from "@/lib/web3/wallet-account";

type Props = {
  accountKind: WalletAccountKind | null;
  photos: File[];
  isLoadingKind?: boolean;
  context?: PassportFlowContext;
};

export function PassportUploadPreflightBanner({
  accountKind,
  photos,
  isLoadingKind = false,
  context = "create",
}: Props) {
  if (isLoadingKind || photos.length === 0) return null;

  const totalBytes = sumFileBytes(photos);
  const hint =
    accountKind != null
      ? passportStorageUploadHint({
          kind: accountKind,
          photoCount: photos.length,
          totalBytes,
        })
      : null;

  if (!hint) return null;

  const isWarning = accountKind === "contract";
  const Icon = isWarning ? AlertTriangle : Info;

  return (
    <div
      className={
        isWarning
          ? "flex gap-3 rounded-md border border-status-error/40 bg-bg-card p-4"
          : "flex gap-3 rounded-md border border-border-default bg-bg-surface p-4"
      }
      role="status"
    >
      <Icon
        size={18}
        strokeWidth={1.5}
        className="mt-0.5 shrink-0 text-text-secondary"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="font-sans text-sm text-text-secondary">{hint}</p>
        <p className="font-mono text-xs text-text-tertiary">
          {preflightPhotoCountLabel(context, photos.length, formatUploadSize(totalBytes))}
        </p>
      </div>
    </div>
  );
}
