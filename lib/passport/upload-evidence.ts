import type { IrysTag } from "@/lib/passport/upload-passport-metadata";
import { uploadFile } from "@/lib/storage/irys-client";
import { withRetry } from "@/lib/storage/upload-with-retry";

const EVIDENCE_TAGS: IrysTag[] = [
  { name: "app", value: "kargain" },
  { name: "type", value: "passport-evidence" },
];

export async function uploadEvidenceFile(
  file: File,
  provider: unknown,
): Promise<string> {
  return withRetry(() => uploadFile(file, EVIDENCE_TAGS, provider));
}
