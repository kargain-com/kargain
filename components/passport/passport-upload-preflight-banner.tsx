"use client";

import { CircleInformationIcon, WarningIcon } from "@/components/ui/icons";

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

/**
 * Preflight chrome for passport photo upload.
 * Account-kind hint is EVM-only — when kind is absent (SVM / unread), show
 * the photo-count line only; never invent an EVM-only absence sentence.
 */
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

  // EOA with no size warning → no banner at all.
  if (accountKind != null && hint == null) return null;

  const isWarning = accountKind === "contract";
  const Icon = isWarning ? WarningIcon : CircleInformationIcon;
  const photoLine = preflightPhotoCountLabel(
    context,
    photos.length,
    formatUploadSize(totalBytes),
  );

  // SVM / unread kind: photo-count line only (no account-kind sentence).
  if (accountKind == null) {
    return (
      <div
        className="flex gap-3 rounded-md border border-border-default bg-bg-surface p-4"
        role="status"
      >
        <CircleInformationIcon
          size={18}
          className="mt-0.5 shrink-0 text-text-secondary"
          aria-hidden
        />
        <p className="font-mono text-xs text-text-tertiary">{photoLine}</p>
      </div>
    );
  }

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
        className="mt-0.5 shrink-0 text-text-secondary"
        aria-hidden
      />
      <div className="space-y-1">
        <p className="font-sans text-sm text-text-secondary">{hint}</p>
        <p className="font-mono text-xs text-text-tertiary">{photoLine}</p>
      </div>
    </div>
  );
}
