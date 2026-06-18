import { isIrysDevnet, uploadFiles, uploadJson } from "@/lib/storage/irys-client";

export type IrysTag = { name: string; value: string };

export type UploadProgress =
  | { kind: "photos"; current: number; total: number }
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
        ? "Irys storage needs a small deposit of Base Sepolia ETH. Confirm the fund transaction in your wallet, then try again."
        : "Insufficient Irys balance for storage. Confirm the fund transaction in your wallet, then try again.";
    }
    return err.message;
  }
  return "Upload failed. Please try again.";
}

export async function uploadPassportPhotos(
  files: File[],
  provider: unknown,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string[]> {
  if (files.length === 0) return [];

  if (files.length === 1) {
    onProgress?.({ kind: "photos", current: 0, total: 1 });
    const uris = await withRetry(() => uploadFiles(files, PHOTO_TAGS, provider));
    onProgress?.({ kind: "photos", current: 1, total: 1 });
    return uris;
  }

  onProgress?.({ kind: "photos", current: 0, total: files.length });
  const uris = await withRetry(() => uploadFiles(files, PHOTO_TAGS, provider));
  onProgress?.({ kind: "photos", current: files.length, total: files.length });
  return uris;
}

export async function uploadPassportMetadataJson(
  metadata: Record<string, unknown>,
  provider: unknown,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  onProgress?.({ kind: "metadata" });
  return withRetry(() => uploadJson(metadata, METADATA_TAGS, provider));
}

export async function uploadPassportMetadataBundle(params: {
  existingPhotoUris: string[];
  newPhotoFiles: File[];
  metadata: Record<string, unknown>;
  provider: unknown;
  onProgress?: (progress: UploadProgress) => void;
}): Promise<{ photoUris: string[]; metadataUri: string }> {
  const uploaded = await uploadPassportPhotos(
    params.newPhotoFiles,
    params.provider,
    params.onProgress,
  );
  const photoUris = [...params.existingPhotoUris, ...uploaded];
  const metadataUri = await uploadPassportMetadataJson(
    params.metadata,
    params.provider,
    params.onProgress,
  );
  return { photoUris, metadataUri };
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
