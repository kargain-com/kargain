import {
  getIrysUploader,
  isIrysDevnet,
  prepareUserPaidUpload,
  uploadFilesWithUploader,
  uploadJson,
  uploadJsonWithUploader,
  type IrysTag,
  type IrysUploader,
} from "@/lib/storage/irys-client";

export type { IrysTag };

export type UploadProgress =
  | { kind: "photos"; current: number; total: number; batch?: boolean }
  | { kind: "metadata" };

const PHOTO_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-photo" },
];

const METADATA_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-metadata" },
  { name: "version", value: "1.1" },
];

const DEFAULT_ATTEMPTS = 3;

async function withRetry<T>(fn: () => Promise<T>, attempts = DEFAULT_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload failed.");
}

export function formatPassportUploadError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message.includes("User rejected")) {
      return "Wallet signature cancelled.";
    }
    if (err.message.includes("402 error")) {
      return isIrysDevnet()
        ? "Your Irys storage balance is too low. Confirm the deposit transaction in your wallet, then try again."
        : "Your Irys storage balance is too low. Confirm the deposit transaction in your wallet, then try again.";
    }
    if (err.message.includes("not sent to any of this bundler")) {
      return "Your wallet could not deposit to Irys storage. Smart wallets often cannot send the required direct transfer — try MetaMask with a standard (EOA) account on Base Sepolia.";
    }
    if (err.message.includes("failed to post funding tx")) {
      return "The Irys storage deposit could not be confirmed. Wait a minute and try again, or use a standard wallet (EOA) on Base Sepolia.";
    }
    return err.message;
  }
  return "Upload failed. Please try again.";
}

export async function uploadPassportPhotos(
  files: File[],
  provider: unknown,
  onProgress?: (progress: UploadProgress) => void,
): Promise<{ uris: string[]; uploader: IrysUploader }> {
  if (files.length === 0) {
    onProgress?.({ kind: "metadata" });
    const uploader = await getIrysUploader(provider);
    return { uris: [], uploader };
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const uploader = await prepareUserPaidUpload(provider, totalBytes);
  const batch = files.length > 1;

  onProgress?.({ kind: "photos", current: 0, total: files.length, batch });

  const uris = await withRetry(() => uploadFilesWithUploader(uploader, files, PHOTO_TAGS));

  onProgress?.({ kind: "photos", current: files.length, total: files.length, batch });
  return { uris, uploader };
}

export async function uploadPassportMetadataJson(
  metadata: Record<string, unknown>,
  provider: unknown,
  onProgress?: (progress: UploadProgress) => void,
  uploader?: IrysUploader,
): Promise<string> {
  onProgress?.({ kind: "metadata" });
  if (uploader) {
    return withRetry(() => uploadJsonWithUploader(uploader, metadata, METADATA_TAGS));
  }
  return withRetry(() => uploadJson(metadata, METADATA_TAGS, provider));
}

/**
 * Photo upload (batch), and metadata JSON upload on one Irys session.
 * `buildMetadata` receives URIs for newly uploaded files only (in upload order).
 */
export async function uploadPassportToIrys(params: {
  newPhotoFiles: File[];
  buildMetadata: (uploadedNewPhotoUris: string[]) => Record<string, unknown>;
  provider: unknown;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<string> {
  const { uris: uploadedNewUris, uploader } = await uploadPassportPhotos(
    params.newPhotoFiles,
    params.provider,
    params.onProgress,
  );
  const metadata = params.buildMetadata(uploadedNewUris);
  return uploadPassportMetadataJson(
    metadata,
    params.provider,
    params.onProgress,
    uploader,
  );
}

export async function getWalletUploadProvider(
  connector: { getProvider?: () => Promise<unknown> } | undefined,
): Promise<unknown> {
  const provider =
    (await connector?.getProvider?.()) ??
    (typeof window !== "undefined" ? window.ethereum : undefined);
  if (!provider) {
    throw new Error("Connect your wallet to continue");
  }
  return provider;
}
