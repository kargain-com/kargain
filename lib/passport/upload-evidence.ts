import { uploadFile } from "@/lib/storage/irys-client";

import type { IrysTag } from "@/lib/passport/upload-passport-metadata";

const EVIDENCE_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-evidence" },
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

export async function uploadEvidenceFile(
  file: File,
  provider: unknown,
): Promise<string> {
  return withRetry(() => uploadFile(file, EVIDENCE_TAGS, provider));
}
