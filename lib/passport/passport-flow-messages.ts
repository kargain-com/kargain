export type PassportFlowContext = "create" | "edit";

export type EditPhase = "idle" | "uploading" | "saving" | "confirming" | "success";

export const VERIFIED_ANCHOR_WARNING =
  "This passport is verified. Anchor field changes will reset verification to unverified.";

export function editPhaseLabel(phase: EditPhase): string {
  switch (phase) {
    case "uploading":
      return "Uploading…";
    case "saving":
      return "Saving…";
    case "confirming":
      return "Confirming…";
    case "success":
      return "Saved";
    default:
      return "Save changes";
  }
}

export function editUploadStarting(): string {
  return "Starting upload…";
}

export function editConfirmingOnChain(chainName: string): string {
  return `Confirming on ${chainName}…`;
}

export function editSavingOnChain(): string {
  return "Saving on-chain…";
}

export const EDIT_SUCCESS_TITLE = "Changes saved";

export function editSuccessBody(opts: { hadVerificationReset: boolean }): string {
  if (opts.hadVerificationReset) {
    return "Your passport was updated. Anchor fields changed, so verification status is now unverified.";
  }
  return "Your passport was updated with the latest metadata and photos.";
}

export const EDIT_INDEXER_SYNC_HINT =
  "Marketplace and profile views may take a moment to reflect your latest changes while the indexer catches up.";

export const INDEXER_SYNC_DETAIL_HINT =
  "Syncing passport history from the indexer…";

export function uploadProgressSubtitle(context: PassportFlowContext): string {
  const cap = "Each photo is optimized to WebP (up to 100 KB) before upload.";
  const storage =
    "Storage may require a separate Base Sepolia ETH deposit to Irys from your wallet — that is not mint gas.";
  if (context === "edit") {
    return `Only new photos are uploaded. ${cap} ${storage}`;
  }
  return `${cap} ${storage}`;
}

export function passportImageOptimizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not optimize one or more photos. Try different images.";
}

export function preflightPhotoCountLabel(context: PassportFlowContext, count: number, totalBytes: string): string {
  const noun = count === 1 ? "photo" : "photos";
  if (context === "edit") {
    return `${count} new ${noun} · ${totalBytes} optimized`;
  }
  return `${count} ${noun} · ${totalBytes} optimized`;
}
